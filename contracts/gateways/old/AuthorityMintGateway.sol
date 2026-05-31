// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ICollectionGateway {
    function mintWithTokenId(
        address to,
        uint256 tokenId,
        string calldata uri
    ) external returns (uint256);
}

/// @title AuthorityMintGateway
/// @notice Simple, collection-agnostic authority minting gateway.
/// @dev Intended mainly for testing / faucet-style mints.
/// Frontends or tools call this contract instead of individual collections.
/// The owner configures which collection contracts are allowed, and this
/// contract must be granted `minter` on each target collection.
contract AuthorityMintGateway is Ownable {
    mapping(address => bool) public allowedCollections;

    event CollectionAllowed(address indexed collection, bool allowed);
    event Minted(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed to,
        string uri
    );

    constructor() Ownable(msg.sender) {}

    /// @notice Allow or disallow a target collection to be minted into via this gateway.
    /// @param collection The collection contract address.
    /// @param allowed True to allow, false to disallow.
    function setCollectionAllowed(
        address collection,
        bool allowed
    ) external onlyOwner {
        require(collection != address(0), "Invalid collection");
        allowedCollections[collection] = allowed;
        emit CollectionAllowed(collection, allowed);
    }

    /// @notice Mint into an arbitrary allowed collection (owner-only, production-safe path).
    /// @dev Caller is the Authority owner; the collection contract must treat
    /// this gateway as a minter (e.g. via setMinter(gateway, true)).
    /// Used for controlled mints rather than public faucets.
    function mint(
        address collection,
        address to,
        string calldata uri,
        uint256 tokenId
    ) external onlyOwner returns (uint256) {
        require(collection != address(0), "Invalid collection");
        require(allowedCollections[collection], "Collection not allowed");
        require(to != address(0), "Invalid recipient");

        uint256 mintedId = ICollectionGateway(collection).mintWithTokenId(
            to,
            tokenId,
            uri
        );

        emit Minted(collection, mintedId, to, uri);
        return mintedId;
    }

    /// @notice Faucet-style mint helper that skips the allowed-collection check.
    /// @dev Intended only for testing or local faucet flows. Do NOT expose this
    /// in untrusted environments without additional access control.
    /// The target collection must still treat this gateway as a minter.
    function mint_nft(
        address collection,
        address to,
        string calldata uri,
        uint256 tokenId
    ) external  returns (uint256) {
        require(collection != address(0), "Invalid collection");
        // require(allowedCollections[collection], "Collection not allowed");
        require(to != address(0), "Invalid recipient");

        uint256 mintedId = ICollectionGateway(collection).mintWithTokenId(
            to,
            tokenId,
            uri
        );

        emit Minted(collection, mintedId, to, uri);
        return mintedId;
    }
}
