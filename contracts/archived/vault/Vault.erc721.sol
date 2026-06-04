// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import { FHE, eaddress, ebool } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Minimal ERC721 burn interface (compatible with Mogate `Collection.sol`).
interface IERC721Burnable {
    function burn(uint256 tokenId) external;
}

/// @notice Minimal ERC721 metadata interface used only for logging burn info.
interface IERC721Metadata {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @title Mogate ERC721 Vault (CoFHE)
/// @notice Holds ERC721s under a public vault address while keeping beneficial ownership encrypted.
/// @dev This vault does NOT hide tx senders; it hides *beneficial owner identity* from on-chain state/call-data.
/// For actions that must touch external contracts (unshield/burn), use an executor/relayer flow.
contract MogateERC721Vault is Ownable, IERC721Receiver {
    struct PendingERC721 {
        address operator;
        address from;
        uint64 receivedAt;
        bool exists;
    }

    /// @notice Optional backend/compliance observer allowed to decrypt ciphertexts (owner + burn requests).
    address public observer;

    /// @notice Executors are allowed to perform externalized actions (unshield/burn).
    mapping(address => bool) public executors;

    /// @dev collection => tokenId => encrypted beneficial owner (eaddress).
    mapping(address => mapping(uint256 => eaddress)) private _beneficialOwner;

    /// @dev collection => tokenId => pending receipt info (used to bind finalize to the ERC721 transfer operator).
    mapping(address => mapping(uint256 => PendingERC721)) private _pending;

    /// @dev collection => tokenId => encrypted burn requested flag (ebool).
    mapping(address => mapping(uint256 => ebool)) private _burnRequested;

    event ObserverUpdated(address indexed observer);
    event ExecutorUpdated(address indexed executor, bool allowed);

    event ERC721Received(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed operator,
        address from,
        bool hasEncryptedOwner
    );

    /// @notice Emitted whenever the encrypted beneficial owner is set or rotated.
    /// @dev `ownerCipher` is a ciphertext (bytes32). Only allowed decryptors can learn the plaintext owner.
    event BeneficialOwnerUpdated(
        address indexed collection,
        uint256 indexed tokenId,
        bytes32 ownerCipher
    );

    /// @notice A (possibly valid) burn request was posted.
    /// @dev Executors should verify off-chain whether the request is valid, then call `executeBurnERC721`.
    event BurnRequested(
        address indexed collection,
        uint256 indexed tokenId,
        bytes32 ownerCipher,
        bytes32 burnRequestedCipher
    );

    /// @notice Vault executed a burn. Includes best-effort tokenURI for backend audit trails.
    event BurnExecuted(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed executor,
        bytes32 ownerCipher,
        string tokenUri
    );

    /// @notice Vault executed an unshield transfer (NFT leaves the vault and becomes publicly owned again).
    event UnshieldExecuted(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed executor,
        address to,
        bytes32 ownerCipher
    );

    constructor(address initialObserver) Ownable(msg.sender) {
        observer = initialObserver;
        emit ObserverUpdated(initialObserver);
    }

    modifier onlyExecutor() {
        require(msg.sender == owner() || executors[msg.sender], "NotExecutor");
        _;
    }

    function setObserver(address newObserver) external onlyOwner {
        observer = newObserver;
        emit ObserverUpdated(newObserver);
    }

    function setExecutor(address executor, bool allowed) external onlyOwner {
        executors[executor] = allowed;
        emit ExecutorUpdated(executor, allowed);
    }

    /// @notice ERC721 receiver hook. Records pending info, and optionally sets encrypted owner if provided in `data`.
    /// @dev `msg.sender` is the ERC721 collection contract address.
    /// `data` MAY be ABI-encoded as expected by `FHE.asEaddress(bytes)`:
    /// `(uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature)`.
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        address collection = msg.sender;

        _pending[collection][tokenId] = PendingERC721({
            operator: operator,
            from: from,
            receivedAt: uint64(block.timestamp),
            exists: true
        });

        emit ERC721Received(collection, tokenId, operator, from, data.length > 0);

        // If the sender included an encrypted beneficial owner in `data`,
        // set it immediately (atomic shield + register).
        if (data.length > 0) {
            _setBeneficialOwner(collection, tokenId, data);
            _pending[collection][tokenId].exists = false;
        }

        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Finalize a received ERC721 by attaching the encrypted beneficial owner.
    /// @dev Only the transfer `operator` recorded in `onERC721Received` can finalize.
    /// This pattern supports both:
    /// 1) mint-to-vault from a contract (operator = minter contract, e.g. raffle)
    /// 2) safeTransferFrom into the vault (operator = the caller of safeTransferFrom)
    function finalizeReceivedERC721(
        address collection,
        uint256 tokenId,
        bytes calldata encryptedOwner
    ) external {
        PendingERC721 memory p = _pending[collection][tokenId];
        require(p.exists, "NoPending");
        require(p.operator == msg.sender, "NotPendingOperator");

        // Ensure token is actually in-vault.
        require(IERC721(collection).ownerOf(tokenId) == address(this), "NotInVault");

        _pending[collection][tokenId].exists = false;
        _setBeneficialOwner(collection, tokenId, encryptedOwner);
    }

    /// @notice Unsafe helper: sets beneficial owner using a public plaintext address.
    /// @dev Useful for dev/testing when encrypted inputs are not available.
    /// This is NOT privacy-preserving (plaintext address appears in calldata).
    function unsafeFinalizeReceivedERC721(
        address collection,
        uint256 tokenId,
        address plaintextOwner
    ) external {
        PendingERC721 memory p = _pending[collection][tokenId];
        require(p.exists, "NoPending");
        require(p.operator == msg.sender, "NotPendingOperator");
        require(IERC721(collection).ownerOf(tokenId) == address(this), "NotInVault");

        _pending[collection][tokenId].exists = false;

        eaddress ownerEnc = FHE.asEaddress(plaintextOwner);
        _storeBeneficialOwner(collection, tokenId, ownerEnc);
    }

    /// @notice Rotate beneficial ownership (vault-only transfer). This does not move the NFT on-chain.
    /// @dev Unauthorized callers won't learn whether they succeeded; state is always updated via FHE.select.
    function transferBeneficialOwnerERC721(
        address collection,
        uint256 tokenId,
        bytes calldata encryptedNewOwner
    ) external {
        require(IERC721(collection).ownerOf(tokenId) == address(this), "NotInVault");

        eaddress current = _beneficialOwner[collection][tokenId];
        require(FHE.isInitialized(current), "OwnerMissing");

        // Compare encrypted owner vs. (trivially encrypted) msg.sender.
        eaddress caller = FHE.asEaddress(msg.sender);
        FHE.allowThis(caller);

        ebool isOwner = FHE.eq(current, caller);
        FHE.allowThis(isOwner);

        eaddress desired = FHE.asEaddress(encryptedNewOwner);
        FHE.allowThis(desired);

        // Always write a fresh ciphertext to avoid leaking auth via unchanged state.
        eaddress updated = FHE.select(isOwner, desired, current);
        _storeBeneficialOwner(collection, tokenId, updated);
    }

    /// @notice Post a burn request. Executors should verify off-chain and then call `executeBurnERC721`.
    function requestBurnERC721(address collection, uint256 tokenId) external {
        require(IERC721(collection).ownerOf(tokenId) == address(this), "NotInVault");

        eaddress current = _beneficialOwner[collection][tokenId];
        require(FHE.isInitialized(current), "OwnerMissing");

        eaddress caller = FHE.asEaddress(msg.sender);
        FHE.allowThis(caller);

        ebool isOwner = FHE.eq(current, caller);
        FHE.allowThis(isOwner);

        ebool prev = _burnRequested[collection][tokenId];
        if (!FHE.isInitialized(prev)) {
            prev = FHE.asEbool(false);
            FHE.allowThis(prev);
        }

        ebool yes = FHE.asEbool(true);
        FHE.allowThis(yes);

        ebool next = FHE.select(isOwner, yes, prev);
        FHE.allowThis(next);
        if (observer != address(0)) {
            FHE.allow(next, observer);
            FHE.allow(current, observer);
        }
        _burnRequested[collection][tokenId] = next;

        emit BurnRequested(
            collection,
            tokenId,
            eaddress.unwrap(current),
            ebool.unwrap(next)
        );
    }

    /// @notice Execute a burn for a vaulted ERC721.
    /// @dev This requires an executor (backend/relayer) because it touches the external ERC721 contract.
    /// Backend can decrypt `ownerCipher` from the event for audit/compliance.
    function executeBurnERC721(address collection, uint256 tokenId) external onlyExecutor {
        require(IERC721(collection).ownerOf(tokenId) == address(this), "NotInVault");

        eaddress ownerEnc = _beneficialOwner[collection][tokenId];
        bytes32 ownerCipher = eaddress.unwrap(ownerEnc);

        string memory uri = _tryTokenURI(collection, tokenId);

        // Burn first (reverts if not supported), then clear local state.
        IERC721Burnable(collection).burn(tokenId);

        _beneficialOwner[collection][tokenId] = eaddress.wrap(bytes32(0));
        delete _pending[collection][tokenId];
        _burnRequested[collection][tokenId] = ebool.wrap(bytes32(0));

        emit BurnExecuted(collection, tokenId, msg.sender, ownerCipher, uri);
    }

    /// @notice Unshield (withdraw) a vaulted ERC721 back to a public address.
    /// @dev This requires an executor (backend/relayer) because it touches the external ERC721 contract.
    function executeUnshieldERC721(
        address collection,
        uint256 tokenId,
        address to
    ) external onlyExecutor {
        require(to != address(0), "BadTo");
        require(IERC721(collection).ownerOf(tokenId) == address(this), "NotInVault");

        eaddress ownerEnc = _beneficialOwner[collection][tokenId];
        bytes32 ownerCipher = eaddress.unwrap(ownerEnc);

        IERC721(collection).safeTransferFrom(address(this), to, tokenId);

        _beneficialOwner[collection][tokenId] = eaddress.wrap(bytes32(0));
        delete _pending[collection][tokenId];
        _burnRequested[collection][tokenId] = ebool.wrap(bytes32(0));

        emit UnshieldExecuted(collection, tokenId, msg.sender, to, ownerCipher);
    }

    // =============================================================
    // Internal helpers
    // =============================================================

    function _setBeneficialOwner(
        address collection,
        uint256 tokenId,
        bytes calldata encryptedOwner
    ) internal {
        eaddress ownerEnc = FHE.asEaddress(encryptedOwner);
        _storeBeneficialOwner(collection, tokenId, ownerEnc);
    }

    function _storeBeneficialOwner(
        address collection,
        uint256 tokenId,
        eaddress ownerEnc
    ) internal {
        FHE.allowThis(ownerEnc);
        if (observer != address(0)) {
            FHE.allow(ownerEnc, observer);
        }

        _beneficialOwner[collection][tokenId] = ownerEnc;

        emit BeneficialOwnerUpdated(collection, tokenId, eaddress.unwrap(ownerEnc));
    }

    function _tryTokenURI(address collection, uint256 tokenId) internal view returns (string memory) {
        (bool ok, bytes memory data) = collection.staticcall(
            abi.encodeWithSelector(IERC721Metadata.tokenURI.selector, tokenId)
        );
        if (!ok || data.length == 0) return "";
        return abi.decode(data, (string));
    }
}
