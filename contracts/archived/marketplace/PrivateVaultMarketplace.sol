// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../vault/Vault.erc721.sol";

/// @title PrivateVaultMarketplace
/// @notice Minimal marketplace for ERC721 tokens held inside MogateERC721Vault.
/// @dev This marketplace assumes that all listed tokens are owned on-chain by the vault.
contract PrivateVaultMarketplace is Ownable {
    struct Listing {
        address collection;
        uint256 tokenId;
        uint256 priceWei;
        address seller; // plaintext seller address (beneficial owner at listing time)
        bool active;
    }

    MogateERC721Vault public immutable vault;
    uint256 public nextListingId;
    mapping(uint256 => Listing) public listings;

    event Listed(
        uint256 indexed listingId,
        address indexed collection,
        uint256 indexed tokenId,
        uint256 priceWei,
        address seller
    );

    event Cancelled(uint256 indexed listingId);

    event Purchased(
        uint256 indexed listingId,
        address indexed buyer,
        uint256 priceWei
    );

    constructor(address vaultAddress) Ownable(msg.sender) {
        require(vaultAddress != address(0), "BadVault");
        vault = MogateERC721Vault(vaultAddress);
    }

    /// @notice Create a listing for a vaulted ERC721.
    /// @dev v1 implementation trusts the caller as seller; stronger checks can be layered off-chain
    ///      using the vault's FHE events (BeneficialOwnerUpdated).
    function list(
        address collection,
        uint256 tokenId,
        uint256 priceWei
    ) external {
        require(priceWei > 0, "PriceZero");

        uint256 listingId = nextListingId++;

        listings[listingId] = Listing({
            collection: collection,
            tokenId: tokenId,
            priceWei: priceWei,
            seller: msg.sender,
            active: true
        });

        emit Listed(listingId, collection, tokenId, priceWei, msg.sender);
    }

    /// @notice Cancel an active listing.
    function cancel(uint256 listingId) external {
        Listing storage l = listings[listingId];
        require(l.active, "NotActive");
        require(l.seller == msg.sender || msg.sender == owner(), "NotSeller");

        l.active = false;
        emit Cancelled(listingId);
    }

    /// @notice Buy a vaulted ERC721.
    /// @param encryptedNewOwner Bytes produced by @cofhe/sdk (encoded InEaddress) for the buyer's address.
    function buy(uint256 listingId, bytes calldata encryptedNewOwner) external payable {
        Listing storage l = listings[listingId];
        require(l.active, "NotActive");
        require(msg.value == l.priceWei, "BadPayment");

        l.active = false;

        // Rotate beneficial owner inside the vault; vault remains on-chain owner.
        vault.transferBeneficialOwnerERC721(
            l.collection,
            l.tokenId,
            encryptedNewOwner
        );

        // Payout to seller (simple direct transfer; can be upgraded to a withdraw pattern).
        (bool ok, ) = payable(l.seller).call{value: msg.value}("");
        require(ok, "PayoutFailed");

        emit Purchased(listingId, msg.sender, msg.value);
    }
}
