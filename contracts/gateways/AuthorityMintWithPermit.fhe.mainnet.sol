// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { FHE, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFHECollection {
    /// @notice Mint a new giftcode NFT with encrypted key.
    /// @param to Recipient address.
    /// @param uri Metadata URI for the newly minted token.
    /// @param encKey FHE encrypted key handle.
    /// @param cipherRef Reference to ciphertext payload.
    /// @return tokenId The minted token id.
    function mint(address to, string calldata uri, InEuint128 calldata encKey, string calldata cipherRef) external returns (uint256 tokenId);
}

interface IFHERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title FHEAuthorityMintWithPermit
/// @notice FHE-enabled authority mint contract that mints giftcode NFTs based on signed permits.
/// @dev The backend signs permits off-chain; users submit them on-chain to mint.
/// This allows dynamic minting rules and pricing to live in the backend.
contract FHEAuthorityMintWithPermit is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Mapping of allowed collections
    mapping(address => bool) public allowedCollections;
    /// @notice Backend EOA that signs mint permits.
    address public backendSigner;

    /// @notice Tracks which permit hashes have already been consumed.
    mapping(bytes32 => bool) public usedPermits;

    /// @notice Emitted when the backend signer address is updated.
    event BackendSignerUpdated(address indexed signer);
    /// @notice Emitted when a collection is allowed/disallowed.
    event CollectionAllowed(address indexed collection, bool allowed);
    /// @notice Emitted after a successful permit-based mint.
    event MintedWithPermit(address indexed to, uint256 indexed tokenId, uint256 nonce, string uri, address indexed collection);
    /// @notice Emitted when payment is received for an order.
    event OrderPaymentReceived(
        string indexed orderId,
        address indexed payer,
        address paymentToken,
        uint256 amount
    );
    /// @notice Emitted when an order is executed.
    event OrderExecuted(
        string indexed orderId,
        address indexed executor,
        uint256 indexed tokenId,
        bool success
    );

    /// @param backendSigner_ Initial backend signer EOA.
    constructor(address backendSigner_)
        Ownable(msg.sender)
    {
        require(backendSigner_ != address(0), "Invalid signer");
        backendSigner = backendSigner_;
    }

    /// @notice Update the backend signer that is allowed to authorize mints.
    /// @param backendSigner_ New backend signer EOA.
    function setBackendSigner(address backendSigner_) external onlyOwner {
        require(backendSigner_ != address(0), "Invalid signer");
        backendSigner = backendSigner_;
        emit BackendSignerUpdated(backendSigner_);
    }

    /// @notice Allow or disallow a target collection to be minted into via this gateway.
    /// @param collection The collection contract address.
    /// @param allowed True to allow, false to disallow.
    function setCollectionAllowed(address collection, bool allowed) external onlyOwner {
        require(collection != address(0), "Invalid collection");
        allowedCollections[collection] = allowed;
        emit CollectionAllowed(collection, allowed);
    }

    /// @notice Mint a new giftcode NFT using a signed backend permit.
    /// @dev The permit binds (this contract, recipient, uri, encKey, cipherRef, amount, nonce, expiry).
    /// Reverts if the permit is expired, reused, or not signed by `backendSigner`.
    /// @param orderId Unique order identifier for tracking.
    /// @param collection Target collection contract.
    /// @param to Recipient of the NFT.
    /// @param uri Metadata URI for the NFT.
    /// @param encKey FHE encrypted key handle.
    /// @param cipherRef Reference to ciphertext payload.
    /// @param paymentToken Payment token (address(0) for native ETH).
    /// @param amount Payment amount required.
    /// @param isFherc20 True if paymentToken is FHERC20, false otherwise.
    /// @param nonce Unique nonce to prevent replay.
    /// @param expiry Unix timestamp after which the permit is invalid.
    /// @param signature Backend ECDSA signature over the permit payload.
    function mintWithPermit(
        string calldata orderId,
        address collection,
        address to,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef,
        address paymentToken,
        uint256 amount,
        bool isFherc20,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external payable returns (uint256 tokenId) {
        require(bytes(orderId).length > 0, "Invalid order ID");
        require(collection != address(0), "Invalid collection");
        require(allowedCollections[collection], "Collection not allowed");
        require(block.timestamp <= expiry, "Permit expired");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");

        // Handle payment
        if (paymentToken == address(0)) {
            // Native ETH payment
            require(msg.value >= amount, "Insufficient ETH payment");
        } else if (isFherc20) {
            // FHERC20 token payment
            require(msg.value == 0, "ETH not accepted for FHERC20 payment");
            IFHERC20 token = IFHERC20(paymentToken);
            token.transferFrom(msg.sender, address(this), amount);
        } else {
            // ERC20 token payment
            require(msg.value == 0, "ETH not accepted for ERC20 payment");
            IERC20 token = IERC20(paymentToken);
            token.safeTransferFrom(msg.sender, address(this), amount);
        }

        bytes32 permitId = keccak256(abi.encodePacked(
            address(this), 
            orderId,
            collection,
            to, 
            keccak256(bytes(uri)), 
            encKey.ctHash, 
            keccak256(bytes(cipherRef)), 
            paymentToken,
            amount,
            isFherc20,
            nonce, 
            expiry
        ));
        require(!usedPermits[permitId], "Permit used");

        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(permitId);
        address signer = ECDSA.recover(hash, signature);
        require(signer == backendSigner, "Invalid signature");

        usedPermits[permitId] = true;

        tokenId = IFHECollection(collection).mint(to, uri, encKey, cipherRef);

        emit OrderPaymentReceived(orderId, msg.sender, paymentToken, amount);
        emit OrderExecuted(orderId, msg.sender, tokenId, true);
        emit MintedWithPermit(to, tokenId, nonce, uri, collection);
    }

    /// @notice Withdraw collected funds to owner.
    /// @param token Token address (address(0) for native ETH).
    /// @param amount Amount to withdraw.
    /// @param isFherc20 True if token is FHERC20, false otherwise.
    function withdraw(address token, uint256 amount, bool isFherc20) external onlyOwner {
        if (token == address(0)) {
            // Withdraw native ETH
            require(
                address(this).balance >= amount,
                "Insufficient ETH balance"
            );
            payable(owner()).transfer(amount);
        } else if (isFherc20) {
            // Withdraw FHERC20 tokens
            IFHERC20 fherc20 = IFHERC20(token);
            require(
                fherc20.balanceOf(address(this)) >= amount,
                "Insufficient FHERC20 balance"
            );
            fherc20.transfer(owner(), amount);
        } else {
            // Withdraw ERC20 tokens
            IERC20 erc20 = IERC20(token);
            require(
                erc20.balanceOf(address(this)) >= amount,
                "Insufficient token balance"
            );
            erc20.safeTransfer(owner(), amount);
        }
    }

    /// @notice Reusable function to verify permit signature and mark as used.
    /// @param permitId The permit hash to verify.
    /// @param signature The ECDSA signature to verify.
    /// @return valid True if signature is valid and permit not used.
    function _verifyAndUsePermit(bytes32 permitId, bytes calldata signature) internal returns (bool valid) {
        require(!usedPermits[permitId], "Permit used");
        
        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(permitId);
        address signer = ECDSA.recover(hash, signature);
        require(signer == backendSigner, "Invalid signature");
        
        usedPermits[permitId] = true;
        return true;
    }

    /// @notice Safe purchase with signature verification - mint NFT with direct payment.
    /// @dev Requires backend signature to authorize the operation.
    /// @param orderId Unique order identifier for tracking.
    /// @param collection Target collection contract.
    /// @param to Recipient address.
    /// @param uri Metadata URI.
    /// @param encKey FHE encrypted key handle.
    /// @param cipherRef Reference to ciphertext payload.
    /// @param paymentToken Payment token (address(0) for native ETH).
    /// @param amount Payment amount required.
    /// @param isFherc20 True if paymentToken is FHERC20, false otherwise.
    /// @param nonce Unique nonce to prevent replay.
    /// @param expiry Unix timestamp after which the permit is invalid.
    /// @param signature Backend ECDSA signature over the permit payload.
    function safeCheckoutWithPermit(
        string calldata orderId,
        address collection,
        address to,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef,
        address paymentToken,
        uint256 amount,
        bool isFherc20,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    )
        external
        payable
        returns (uint256 tokenId)
    {
        require(collection != address(0), "Invalid collection");
        require(allowedCollections[collection], "Collection not allowed");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(bytes(orderId).length > 0, "Invalid order ID");
        require(block.timestamp <= expiry, "Permit expired");

        // Create permit hash
        bytes32 permitId = keccak256(abi.encodePacked(
            address(this),
            "safeCheckout",
            orderId,
            collection,
            to,
            keccak256(bytes(uri)),
            encKey.ctHash,
            keccak256(bytes(cipherRef)),
            paymentToken,
            amount,
            isFherc20,
            nonce,
            expiry
        ));

        // Verify signature and mark permit as used
        _verifyAndUsePermit(permitId, signature);

        // Handle payment
        if (paymentToken == address(0)) {
            // Native ETH payment
            require(msg.value >= amount, "Insufficient ETH payment");
        } else if (isFherc20) {
            // FHERC20 token payment
            require(msg.value == 0, "ETH not accepted for FHERC20 payment");
            IFHERC20 token = IFHERC20(paymentToken);
            token.transferFrom(msg.sender, address(this), amount);
        } else {
            // ERC20 token payment
            require(msg.value == 0, "ETH not accepted for ERC20 payment");
            IERC20 token = IERC20(paymentToken);
            token.safeTransferFrom(msg.sender, address(this), amount);
        }

        tokenId = IFHECollection(collection).mint(to, uri, encKey, cipherRef);

        emit OrderPaymentReceived(orderId, msg.sender, paymentToken, amount);
        emit OrderExecuted(orderId, msg.sender, tokenId, true);
        emit MintedWithPermit(to, tokenId, nonce, uri, collection);
    }

    /// @notice Safe order payment with signature verification.
    /// @dev Requires backend signature to authorize the payment.
    /// @param orderId Unique order identifier for tracking.
    /// @param paymentToken Payment token (address(0) for native ETH).
    /// @param amount Payment amount required.
    /// @param isFherc20 True if paymentToken is FHERC20, false otherwise.
    /// @param nonce Unique nonce to prevent replay.
    /// @param expiry Unix timestamp after which the permit is invalid.
    /// @param signature Backend ECDSA signature over the permit payload.
    function safeOrderWithPermit(
        string calldata orderId,
        address paymentToken,
        uint256 amount,
        bool isFherc20,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    )
        external
        payable
        returns (uint256)
    {
        require(bytes(orderId).length > 0, "Invalid order ID");
        require(amount > 0, "Amount must be greater than 0");
        require(block.timestamp <= expiry, "Permit expired");

        // Create permit hash
        bytes32 permitId = keccak256(abi.encodePacked(
            address(this),
            "safeOrder",
            orderId,
            paymentToken,
            amount,
            isFherc20,
            nonce,
            expiry
        ));

        // Verify signature and mark permit as used
        _verifyAndUsePermit(permitId, signature);

        // Handle payment
        if (paymentToken == address(0)) {
            // Native ETH payment
            require(msg.value >= amount, "Insufficient ETH payment");
        } else if (isFherc20) {
            // FHERC20 token payment
            require(msg.value == 0, "ETH not accepted for FHERC20 payment");
            IFHERC20 token = IFHERC20(paymentToken);
            token.transferFrom(msg.sender, address(this), amount);
        } else {
            // ERC20 token payment
            require(msg.value == 0, "ETH not accepted for ERC20 payment");
            IERC20 token = IERC20(paymentToken);
            token.safeTransferFrom(msg.sender, address(this), amount);
        }

        emit OrderPaymentReceived(orderId, msg.sender, paymentToken, amount);
        return amount;
    }

    /// @notice Safe mint with signature verification.
    /// @dev Requires backend signature to authorize the mint.
    /// @param orderId Unique order identifier for tracking.
    /// @param collection Target collection contract.
    /// @param to Recipient address.
    /// @param uri Metadata URI.
    /// @param encKey FHE encrypted key handle.
    /// @param cipherRef Reference to ciphertext payload.
    /// @param nonce Unique nonce to prevent replay.
    /// @param expiry Unix timestamp after which the permit is invalid.
    /// @param signature Backend ECDSA signature over the permit payload.
    function safeMintWithPermit(
        string calldata orderId,
        address collection,
        address to,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    )
        external
        returns (uint256 tokenId)
    {
        require(collection != address(0), "Invalid collection");
        require(allowedCollections[collection], "Collection not allowed");
        require(to != address(0), "Invalid recipient");
        require(bytes(orderId).length > 0, "Invalid order ID");
        require(block.timestamp <= expiry, "Permit expired");

        // Create permit hash
        bytes32 permitId = keccak256(abi.encodePacked(
            address(this),
            "safeMint",
            orderId,
            collection,
            to,
            keccak256(bytes(uri)),
            encKey.ctHash,
            keccak256(bytes(cipherRef)),
            nonce,
            expiry
        ));

        // Verify signature and mark permit as used
        _verifyAndUsePermit(permitId, signature);

        tokenId = IFHECollection(collection).mint(to, uri, encKey, cipherRef);

        emit OrderExecuted(orderId, msg.sender, tokenId, true);
        emit MintedWithPermit(to, tokenId, nonce, uri, collection);
        return tokenId;
    }

    /// @notice Safe batch mint with signature verification.
    /// @dev Requires backend signature to authorize the batch mint.
    /// @param orderId Unique order identifier for tracking.
    /// @param collection Target collection contract.
    /// @param to Array of recipient addresses.
    /// @param uris Array of metadata URIs.
    /// @param encKeys Array of FHE encrypted key handles.
    /// @param cipherRefs Array of ciphertext payload references.
    /// @param nonce Unique nonce to prevent replay.
    /// @param expiry Unix timestamp after which the permit is invalid.
    /// @param signature Backend ECDSA signature over the permit payload.
    function safeBatchMintWithPermit(
        string calldata orderId,
        address collection,
        address[] calldata to,
        string[] calldata uris,
        InEuint128[] calldata encKeys,
        string[] calldata cipherRefs,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    )
        external
        returns (uint256[] memory tokenIds)
    {
        require(collection != address(0), "Invalid collection");
        require(allowedCollections[collection], "Collection not allowed");
        require(bytes(orderId).length > 0, "Invalid order ID");
        require(block.timestamp <= expiry, "Permit expired");
        require(
            to.length == uris.length &&
                uris.length == encKeys.length &&
                encKeys.length == cipherRefs.length,
            "Array length mismatch"
        );

        // Create permit hash
        bytes32 permitId = keccak256(abi.encodePacked(
            address(this),
            "safeBatchMint",
            orderId,
            collection,
            keccak256(abi.encodePacked(to)),
            keccak256(abi.encodePacked(uris)),
            keccak256(abi.encodePacked(encKeys)),
            keccak256(abi.encodePacked(cipherRefs)),
            nonce,
            expiry
        ));

        // Verify signature and mark permit as used
        _verifyAndUsePermit(permitId, signature);

        tokenIds = new uint256[](to.length);
        for (uint256 i = 0; i < to.length; i++) {
            require(to[i] != address(0), "Invalid recipient");
            tokenIds[i] = IFHECollection(collection).mint(
                to[i],
                uris[i],
                encKeys[i],
                cipherRefs[i]
            );
        }

        emit OrderExecuted(orderId, msg.sender, tokenIds[0], true);
    }

    /// @notice Allow contract to receive ETH
    receive() external payable {}
