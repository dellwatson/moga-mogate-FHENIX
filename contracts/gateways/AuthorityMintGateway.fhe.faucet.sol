// ⚠️⚠️⚠️ WARNING: TESTNET ONLY - DO NOT DEPLOY ON MAINNET ⚠️⚠️⚠️
// THIS IS A TESTNET VERSION FOR TESTING PURPOSES ONLY
// FOR MAINNET DEPLOYMENT, USE THE MAINNET VERSION OF THIS CONTRACT
// UNAUTHORIZED MAINNET DEPLOYMENT MAY RESULT IN LOSS OF FUNDS
// ⚠️⚠️⚠️ WARNING: TESTNET ONLY - DO NOT DEPLOY ON MAINNET ⚠️⚠️⚠️

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import {FHE, euint128, InEuint128} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICollectionGateway {
    function mintWithTokenId(
        address to,
        uint256 tokenId,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef
    ) external returns (uint256);

    function mint(
        address to,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef
    ) external returns (uint256);
}

interface IFHERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title AuthorityMintGateway
/// @notice Simple, collection-agnostic authority minting gateway.
/// @dev Intended mainly for testing / faucet-style mints.
/// Frontends or tools call this contract instead of individual collections.
/// The owner configures which collection contracts are allowed, and this
/// contract must be granted `minter` on each target collection.
contract AuthorityMintGateway is Ownable {
    using SafeERC20 for IERC20;

    mapping(address => bool) public allowedCollections;

    event CollectionAllowed(address indexed collection, bool allowed);
    event Minted(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed to,
        string uri
    );
    event Purchased(
        address indexed collection,
        address indexed buyer,
        uint256 indexed tokenId,
        address paymentToken,
        uint256 amount
    );

    event OrderPaymentReceived(
        string indexed orderId,
        address indexed payer,
        address paymentToken,
        uint256 amount
    );
    
    event OrderExecuted(
        string indexed orderId,
        address indexed executor,
        uint256 indexed tokenId,
        bool success
    );

    constructor() Ownable(msg.sender) {}

    /// @notice Allow or disallow a target collection to be minted into via this gateway.
    /// @param collection The collection contract address.
    /// @param allowed True to allow, false to disallow.
    // purpose: to easily ban the collection
    function setCollectionAllowed(
        address collection,
        bool allowed
    ) external onlyOwner {
        require(collection != address(0), "Invalid collection");
        allowedCollections[collection] = allowed;
        emit CollectionAllowed(collection, allowed);
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

    /// @notice Mint into an arbitrary allowed collection with specific tokenId.
    function mintWithTokenId(
        address collection,
        address to,
        uint256 tokenId,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef
    )
        external
        // this is a signature in permit version
        onlyOwner
        returns (uint256)
    {
        require(collection != address(0), "Invalid collection");
        // require(allowedCollections[collection], "Collection not allowed");
        require(to != address(0), "Invalid recipient");

        uint256 mintedId = ICollectionGateway(collection).mintWithTokenId(
            to,
            tokenId,
            uri,
            encKey,
            cipherRef
        );

        emit Minted(collection, mintedId, to, uri);
        return mintedId;
    }

    /// @notice Unsafe purchase - mint NFT with direct payment (no signature required).
    /// @dev WARNING: This function allows anyone to mint if they pay the required amount.
    ///      Use only for testing or when access control is handled elsewhere.
    ///      For production, use the permit-based version with signature verification.
    /// @param orderId Unique order identifier for tracking.
    /// @param collection Target collection contract.
    /// @param to Recipient address.
    /// @param uri Metadata URI.
    /// @param encKey FHE encrypted key handle.
    /// @param cipherRef Reference to ciphertext payload.
    /// @param paymentToken Payment token (address(0) for native ETH).
    /// @param amount Payment amount required.
    /// @param isFherc20 True if paymentToken is FHERC20, false otherwise.
    function unsafeCheckout(
        string calldata orderId,
        address collection,
        address to,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef,
        address paymentToken,
        uint256 amount,
        bool isFherc20
    )
        external
        payable
        returns (
            // signature here for safe version
            uint256
        )
    {
        require(collection != address(0), "Invalid collection");
        // require(allowedCollections[collection], "Collection not allowed");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(bytes(orderId).length > 0, "Invalid order ID");

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

        uint256 tokenId = ICollectionGateway(collection).mint(
            to,
            uri,
            encKey,
            cipherRef
        );

        emit OrderExecuted(orderId, msg.sender, tokenId, true);
        emit Purchased(collection, msg.sender, tokenId, paymentToken, amount);
        emit Minted(collection, tokenId, to, uri);

        return tokenId;
    }

    function unsafeOrder(
        string calldata orderId,
        address paymentToken,
        uint256 amount,
        bool isFherc20
    )
        external
        payable
        returns (
            // signature here for safe version
            uint256
        )
    {
        require(bytes(orderId).length > 0, "Invalid order ID");
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

        emit OrderPaymentReceived(orderId, msg.sender, paymentToken, amount);
        return amount;
    }

    /// @notice Faucet-style mint helper that skips the allowed-collection check.
    /// @dev Intended only for testing or local faucet flows. Do NOT expose this
    /// in untrusted environments without additional access control.
    /// The target collection must still treat this gateway as a minter.
    function unsafeMint(
        string calldata orderId,
        address collection,
        address to,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef
    )
        external
        returns (
            // signature here for safe version
            uint256
        )
    {
        require(collection != address(0), "Invalid collection");
        // require(allowedCollections[collection], "Collection not allowed");
        require(to != address(0), "Invalid recipient");

        uint256 mintedId = ICollectionGateway(collection).mint(
            to,
            uri,
            encKey,
            cipherRef
        );

        emit Minted(collection, mintedId, to, uri);
        return mintedId;
    }

    /// @notice Batch mint multiple NFTs into an allowed collection.
    function unsafeBatchMint(
        address collection,
        address[] calldata to,
        string[] calldata uris,
        InEuint128[] calldata encKeys,
        string[] calldata cipherRefs
    )
        external
        //signature here for safe version
        onlyOwner
        returns (uint256[] memory tokenIds)
    {
        require(collection != address(0), "Invalid collection");
        // require(allowedCollections[collection], "Collection not allowed");
        require(
            to.length == uris.length &&
                uris.length == encKeys.length &&
                encKeys.length == cipherRefs.length,
            "Array length mismatch"
        );

        tokenIds = new uint256[](to.length);
        for (uint256 i = 0; i < to.length; i++) {
            require(to[i] != address(0), "Invalid recipient");
            tokenIds[i] = ICollectionGateway(collection).mint(
                to[i],
                uris[i],
                encKeys[i],
                cipherRefs[i]
            );
        }
    }

    /// @notice Allow contract to receive ETH
    receive() external payable {}
}
