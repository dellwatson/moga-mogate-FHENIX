// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface ICollectionPermit {
    /// @notice Mint a new token with the given metadata URI to `to`.
    /// @param to Recipient address.
    /// @param uri Metadata URI for the newly minted token.
    /// @return tokenId The minted token id.
    function mintTo(address to, string calldata uri) external returns (uint256 tokenId);
}

/// @title AuthorityMintWithPermit
/// @notice EVM authority mint contract that mints NFTs based on signed permits.
/// @dev The backend signs permits off-chain; users submit them on-chain to mint.
/// This allows dynamic minting rules and pricing to live in the backend.
contract AuthorityMintWithPermit is Ownable {

    /// @notice Target NFT collection that will receive minted tokens.
    ICollectionPermit public collection;
    /// @notice Backend EOA that signs mint permits.
    address public backendSigner;

    /// @notice Tracks which permit hashes have already been consumed.
    mapping(bytes32 => bool) public usedPermits;

    /// @notice Emitted when the backend signer address is updated.
    event BackendSignerUpdated(address indexed signer);
    /// @notice Emitted when the target collection address is updated.
    event CollectionUpdated(address indexed collection);
    /// @notice Emitted after a successful permit-based mint.
    event MintedWithPermit(address indexed to, uint256 indexed tokenId, uint256 nonce, string uri);

    /// @param backendSigner_ Initial backend signer EOA.
    /// @param collection_ Initial target collection contract.
    constructor(address backendSigner_, address collection_)
        Ownable(msg.sender)
    {
        require(backendSigner_ != address(0), "Invalid signer");
        require(collection_ != address(0), "Invalid collection");
        backendSigner = backendSigner_;
        collection = ICollectionPermit(collection_);
    }

    /// @notice Update the backend signer that is allowed to authorize mints.
    /// @param backendSigner_ New backend signer EOA.
    function setBackendSigner(address backendSigner_) external onlyOwner {
        require(backendSigner_ != address(0), "Invalid signer");
        backendSigner = backendSigner_;
        emit BackendSignerUpdated(backendSigner_);
    }

    /// @notice Point this authority contract at a new collection.
    /// @param collection_ New collection contract address.
    function setCollection(address collection_) external onlyOwner {
        require(collection_ != address(0), "Invalid collection");
        collection = ICollectionPermit(collection_);
        emit CollectionUpdated(collection_);
    }

    /// @notice Mint a new token using a signed backend permit.
    /// @dev The permit binds (this contract, recipient, uri, nonce, expiry).
    /// Reverts if the permit is expired, reused, or not signed by `backendSigner`.
    /// @param to Recipient of the NFT.
    /// @param uri Metadata URI for the NFT.
    /// @param nonce Unique nonce to prevent replay.
    /// @param expiry Unix timestamp after which the permit is invalid.
    /// @param signature Backend ECDSA signature over the permit payload.
    function mintWithPermit(
        address to,
        string calldata uri,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external returns (uint256 tokenId) {
        require(block.timestamp <= expiry, "Permit expired");
        require(to != address(0), "Invalid recipient");

        bytes32 permitId = keccak256(abi.encodePacked(address(this), to, keccak256(bytes(uri)), nonce, expiry));
        require(!usedPermits[permitId], "Permit used");

        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(permitId);
        address signer = ECDSA.recover(hash, signature);
        require(signer == backendSigner, "Invalid signature");

        usedPermits[permitId] = true;

        tokenId = collection.mintTo(to, uri);

        emit MintedWithPermit(to, tokenId, nonce, uri);
    }
}
