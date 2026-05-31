// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import { FHE, euint128, InEuint128 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ERC721MG - Mogate Giftcode NFT with FHE-encrypted voucher codes
/// @notice Standard ERC721 compatible collection that stores an encrypted
///         giftcode handle per token, supports one-way unwrap to soulbound,
///         and backend-only burn/cleanup.
contract ERC721MG is ERC721URIStorage, ERC721Enumerable, ERC721Burnable, Ownable {
    mapping(address => bool) public operators;
    mapping(address => bool) public minters;

    uint256 private _nextTokenId;

    // =============================================================
    // Giftcode storage (FHE + optional ciphertext reference)
    // =============================================================

    /// @dev Encrypted AES (or other secret) key handle per token.
    ///      The value is an euint128 ciphertext managed by FHE ACL.
    mapping(uint256 => euint128) private _encKey;

    /// @dev Optional reference to the ciphertext payload (e.g. IPFS CID,
    ///      HTTPS URL, or on-chain hex-encoded blob).
    mapping(uint256 => string) private _cipherRef;

    /// @dev Tracks whether a token has been unwrapped and is now soulbound.
    mapping(uint256 => bool) private _unwrapped;

    // =============================================================
    // Modifiers & roles
    // =============================================================

    modifier onlyOwnerOrOperator() {
        require(owner() == msg.sender || operators[msg.sender], "Not owner/operator");
        _;
    }

    // this meant to be for cross-call contract
    modifier onlyMinter() {
        require(minters[msg.sender], "Not minter");
        _;
    }

    constructor(string memory name_, string memory symbol_)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
    {}

    // =============================================================
    // Admin role management
    // =============================================================

    function setOperator(address operator, bool allowed) external onlyOwner {
        operators[operator] = allowed;
    }

    /// @notice Manage addresses allowed to mint giftcode NFTs.
    /// @dev This role is only for issuance control and is independent from
    ///      FHE decrypt permissions (granted on redeem).
    function setMinter(address minter, bool allowed) external onlyOwnerOrOperator {
        minters[minter] = allowed;
    }

    // =============================================================
    // Minting / tokenisation
    // =============================================================

    /// @notice Mint a new giftcode NFT with an encrypted key and optional ciphertext reference.
    /// @param to Recipient of the NFT.
    /// @param uri Public metadata URI (visible to everyone).
    /// @param encKey Encrypted key produced by @cofhe/sdk (InEuint128).
    /// @param cipherRef Reference to ciphertext payload (IPFS CID, URL, or hex string).
    function mint(
        address to,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef
    ) external onlyMinter returns (uint256 tokenId) {
        // Find next available tokenId, skipping any that already exist
        tokenId = _nextTokenId;
        while (_ownerOf(tokenId) != address(0)) {
            tokenId++;
        }
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        euint128 keyHandle = FHE.asEuint128(encKey);
        FHE.allowThis(keyHandle);

        _encKey[tokenId] = keyHandle;
        _cipherRef[tokenId] = cipherRef;
        
        // Update _nextTokenId to the last minted + 1 for efficiency
        _nextTokenId = tokenId + 1;
    }

    /// @notice Mint with an explicit tokenId (advanced use case).
    /// @dev WARNING: If tokenId already exists, this transaction will REVERT.
    ///      The _safeMint function includes an existence check that prevents
    ///      overwriting existing tokens. Use with caution and ensure tokenId
    ///      uniqueness in your application logic.
    /// @param to Recipient of the NFT.
    /// @param tokenId Specific token ID to mint (must be unique).
    /// @param uri Public metadata URI.
    /// @param encKey Encrypted key handle.
    /// @param cipherRef Reference to ciphertext payload.
    /// @return The same tokenId that was minted.
    function mintWithTokenId(
        address to,
        uint256 tokenId,
        string calldata uri,
        InEuint128 calldata encKey,
        string calldata cipherRef
    ) external onlyMinter returns (uint256) {
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        euint128 keyHandle = FHE.asEuint128(encKey);
        FHE.allowThis(keyHandle);

        _encKey[tokenId] = keyHandle;
        _cipherRef[tokenId] = cipherRef;

        // Update nextTokenId to maintain sequential numbering
        if (tokenId >= _nextTokenId) {
            _nextTokenId = tokenId + 1;
        }

        return tokenId;
    }

    // =============================================================
    // Read helpers
    // =============================================================

    function cipherRef(uint256 tokenId) external view returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Nonexistent");
        return _cipherRef[tokenId];
    }

    /// @notice Return the encrypted key handle for this token.
    /// @dev The handle is safe to expose; only addresses granted by FHE ACL
    ///      can decrypt it using cofhe SDK.
    function encryptedKey(uint256 tokenId) external view returns (euint128) {
        require(_ownerOf(tokenId) != address(0), "Nonexistent");
        return _encKey[tokenId];
    }

    function isUnwrapped(uint256 tokenId) external view returns (bool) {
        require(_ownerOf(tokenId) != address(0), "Nonexistent");
        return _unwrapped[tokenId];
    }

    /// @notice Batch check if multiple tokens are unwrapped
    /// @dev Gas efficient for checking multiple tokens at once
    function batchIsUnwrapped(uint256[] calldata tokenIds) external view returns (bool[] memory) {
        bool[] memory results = new bool[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (_ownerOf(tokenIds[i]) != address(0)) {
                results[i] = _unwrapped[tokenIds[i]];
            }
        }
        return results;
    }

    // =============================================================
    // Unwrap → Soulbound + FHE unlock (no backend)
    // =============================================================

    /// @notice Unwrap a giftcode NFT into a soulbound token and grant
    ///         the holder FHE read access to decrypt the giftcode.
    function unwrap(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "NotOwner");
        require(!_unwrapped[tokenId], "AlreadyUnwrapped");

        _unwrapped[tokenId] = true;

        euint128 keyHandle = _encKey[tokenId];
        require(FHE.isInitialized(keyHandle), "CodeMissing");

        // Allow this holder to decrypt via cofhe SDK decryptForView.
        FHE.allow(keyHandle, msg.sender);
    }

    // =============================================================
    // Backend-only burn / cleanup
    // =============================================================

    /// @notice Burn the unwrapped (soulbound) token and clear encrypted data.
    /// @dev Intended to be called by backend after the off-chain giftcode
    ///      has been used/consumed at the merchant.
    // intended FOR RE-MINT and FOR CLEANUP. (should only be executed aftre confirming in the offchain)
    function burn(uint256 tokenId) public override onlyOwnerOrOperator {
        require(_unwrapped[tokenId], "NotWrapped");
        _burn(tokenId);

        _encKey[tokenId] = euint128.wrap(0);
        _cipherRef[tokenId] = "";

    }

    // =============================================================
    // Soulbound behaviour
    // =============================================================

    /// @dev Internal check to ensure token is not soulbound (unwrapped).
    ///      Once a token is unwrapped, it becomes permanently non-transferable.
    ///      This function is called before any transfer operation to prevent
    ///      moving soulbound tokens, which would break the giftcode system.
    /// @param tokenId The token ID to check.
    function _requireNotSoulbound(uint256 tokenId) internal view {
        require(!_unwrapped[tokenId], "Token is soulbound and cannot be transferred");
    }

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override(ERC721, IERC721) {
        _requireNotSoulbound(tokenId);
        super.transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public override(ERC721, IERC721) {
        _requireNotSoulbound(tokenId);
        super.safeTransferFrom(from, to, tokenId, data);
    }


    // =============================================================
    // Batch operations
    // =============================================================

    /// @notice Mint multiple giftcode NFTs in a single transaction.
    function batchMint(
        address[] calldata to,
        string[] calldata uris,
        InEuint128[] calldata encKeys,
        string[] calldata cipherRefs
    ) external onlyMinter returns (uint256[] memory tokenIds) {
        require(to.length == uris.length && uris.length == encKeys.length && encKeys.length == cipherRefs.length, "Array length mismatch");
        
        tokenIds = new uint256[](to.length);
        for (uint256 i = 0; i < to.length; i++) {
            // Find next available tokenId, skipping any that already exist
            uint256 tokenId = _nextTokenId;
            while (_ownerOf(tokenId) != address(0)) {
                tokenId++;
            }
            
            tokenIds[i] = tokenId;
            _safeMint(to[i], tokenId);
            _setTokenURI(tokenId, uris[i]);

            euint128 keyHandle = FHE.asEuint128(encKeys[i]);
            FHE.allowThis(keyHandle);

            _encKey[tokenId] = keyHandle;
            _cipherRef[tokenId] = cipherRefs[i];
            
            // Update _nextTokenId for next iteration
            _nextTokenId = tokenId + 1;
        }
    }

    /// @notice Unwrap multiple giftcode NFTs into soulbound tokens.
    function batchUnwrap(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(ownerOf(tokenIds[i]) == msg.sender, "NotOwner");
            require(!_unwrapped[tokenIds[i]], "AlreadyUnwrapped");

            _unwrapped[tokenIds[i]] = true;

            euint128 keyHandle = _encKey[tokenIds[i]];
            require(FHE.isInitialized(keyHandle), "CodeMissing");

            FHE.allow(keyHandle, msg.sender);
        }
    }

    /// @notice Burn multiple wrapped NFTs in a single transaction.
    function batchBurn(uint256[] calldata tokenIds) external onlyOwnerOrOperator {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(_unwrapped[tokenIds[i]], "NotWrapped");
            _burn(tokenIds[i]);

            _encKey[tokenIds[i]] = euint128.wrap(0);
            _cipherRef[tokenIds[i]] = "";
        }
    }


    // =============================================================
    // Enumerable overrides
    // =============================================================

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
