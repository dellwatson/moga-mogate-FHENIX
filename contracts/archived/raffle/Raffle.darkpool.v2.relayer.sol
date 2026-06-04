// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import { FHE, eaddress } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Minimal interface for the external NFT collection used for prizes.
interface ICollectionMintRelayed {
    function mintTo(address to, string calldata uri) external returns (uint256);
}

/// @notice Minimal interface for Mogate's ERC721 vault.
interface IMogateERC721VaultRelayed {
    function finalizeReceivedERC721(
        address collection,
        uint256 tokenId,
        bytes calldata encryptedOwner
    ) external;

    function unsafeFinalizeReceivedERC721(
        address collection,
        uint256 tokenId,
        address plaintextOwner
    ) external;
}

/// @title Mogate Darkpool Raffle V2 (Relayer-First + coFHE)
/// @notice User-facing privacy version: slot occupancy is public, slot owner is stored as encrypted eaddress.
/// @dev This contract is designed to be called by a relayer so explorers show the relayer as tx sender.
/// It does NOT store participant plaintext addresses on-chain.
contract RaffleDarkpoolV2Relayer is Ownable {
    constructor(address initialObserver) Ownable(msg.sender) {
        observer = initialObserver;
        emit ObserverUpdated(initialObserver);
    }

    enum RaffleStatus {
        OPEN,
        FILLED,
        DRAWN,
        CANCELLED
    }

    enum PrizeTokenType {
        NONE,
        ERC721,
        ERC1155,
        ERC404
    }

    struct RaffleCfg {
        string raffleId;
        address organizer;
        uint256 totalSlots;
        uint256 maxSlotsPerWallet;
        string metadataUri;
        address collection;
        PrizeTokenType prizeType;
        uint256 prizeAmount;
        bool autoDraw;
        bool autoClaim;
        uint64 createdAt;
        uint64 expiresAt;
        RaffleStatus status;
        uint256 soldSlots;
        uint256 winnerSlot;
        bool claimed;
    }

    /// @notice Backend/observer allowed to decrypt ciphertexts (slot owners).
    address public observer;

    /// @notice Allowed relayers. When enabled, relayers are the visible on-chain sender.
    mapping(address => bool) public relayers;

    mapping(bytes32 => RaffleCfg) private _raffles;

    /// @dev Public: slot occupancy (for UI/UX).
    mapping(bytes32 => mapping(uint256 => bool)) private _slotTaken;

    /// @dev Private: encrypted slot owner.
    mapping(bytes32 => mapping(uint256 => eaddress)) private _slotOwnerEnc;

    /// @dev Per-raffle slot count per encrypted owner handle (ciphertext id). Does not reveal plaintext owner.
    mapping(bytes32 => mapping(bytes32 => uint256)) private _ownerSlotCountByCipher;

    event ObserverUpdated(address indexed observer);
    event RelayerUpdated(address indexed relayer, bool allowed);

    event DarkpoolHosted(bytes32 indexed id, string raffleId, address indexed organizer);
    event DarkpoolJoined(bytes32 indexed id, uint256[] slots, uint256 paidAmount);
    event DarkpoolFilled(bytes32 indexed id, uint256 totalSlots);
    event DarkpoolDrawn(bytes32 indexed id, uint256 winnerSlot);
    event DarkpoolPrizeMinted(bytes32 indexed id, address indexed to, uint256 tokenId, string metadataUri);

    modifier onlyRelayer() {
        require(relayers[msg.sender] || msg.sender == owner(), "NotRelayer");
        _;
    }

    // =============================================================
    // Admin
    // =============================================================

    function setObserver(address newObserver) external onlyOwner {
        observer = newObserver;
        emit ObserverUpdated(newObserver);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    // =============================================================
    // Host
    // =============================================================

    /// @notice Unsafe host: off-chain can decide pricing; this contract only handles occupancy + encrypted owners.
    function unsafeHostRaffle(
        string calldata raffleId,
        uint256 totalSlots,
        uint256 maxSlotsPerWallet,
        string calldata metadataUri,
        address collection,
        PrizeTokenType prizeType,
        uint256 prizeAmount,
        bool autoDraw,
        bool autoClaim,
        uint64 expiresAt
    ) external returns (bytes32 id) {
        require(totalSlots > 0, "TotalSlotsZero");
        require(maxSlotsPerWallet > 0, "MaxSlotsZero");

        id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length == 0, "RaffleExists");

        r.raffleId = raffleId;
        r.organizer = msg.sender;
        r.totalSlots = totalSlots;
        r.maxSlotsPerWallet = maxSlotsPerWallet;
        r.metadataUri = metadataUri;
        r.collection = collection;
        r.prizeType = prizeType == PrizeTokenType.NONE ? PrizeTokenType.ERC721 : prizeType;
        r.prizeAmount = prizeAmount == 0 ? 1 : prizeAmount;
        r.autoDraw = autoDraw;
        r.autoClaim = autoClaim;
        r.createdAt = uint64(block.timestamp);
        r.expiresAt = expiresAt;
        r.status = RaffleStatus.OPEN;

        emit DarkpoolHosted(id, raffleId, msg.sender);
    }

    // =============================================================
    // Join (Relayed)
    // =============================================================

    /// @notice Join using an encrypted owner identity (preferred).
    /// @dev `encryptedOwner` must be bytes compatible with `FHE.asEaddress(bytes)`.
    /// Payment is provided by the relayer (msg.value), with amount decided off-chain.
    function unsafeJoinRaffleRelayed(
        string calldata raffleId,
        uint256[] calldata slotIds,
        uint256 amount,
        address token,
        bytes calldata encryptedOwner
    ) external payable onlyRelayer {
        require(token == address(0), "ERC20Disabled");
        require(msg.value == amount, "BadPayment");
        require(slotIds.length > 0, "NoSlots");

        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.OPEN, "NotOpen");
        if (r.expiresAt != 0) {
            require(block.timestamp <= r.expiresAt, "RaffleExpired");
        }

        uint256 requested = slotIds.length;
        uint256 remaining = r.totalSlots - r.soldSlots;
        require(requested <= remaining, "OverCapacity");

        // Verify encrypted owner input (returns an eaddress handle).
        eaddress ownerEnc = FHE.asEaddress(encryptedOwner);
        FHE.allowThis(ownerEnc);
        if (observer != address(0)) {
            FHE.allow(ownerEnc, observer);
        }

        bytes32 ownerKey = eaddress.unwrap(ownerEnc);
        uint256 currentCount = _ownerSlotCountByCipher[id][ownerKey];
        require(currentCount + requested <= r.maxSlotsPerWallet, "MaxSlotsPerWallet");

        // Validate all slots first (no partial writes).
        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            require(slot >= 1 && slot <= r.totalSlots, "SlotOutOfRange");

            // prevent duplicates within the same request
            for (uint256 j = 0; j < i; j++) {
                require(slotIds[j] != slot, "DuplicateSlot");
            }
            require(!_slotTaken[id][slot], "SlotTaken");
        }

        // Apply writes.
        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            _slotTaken[id][slot] = true;
            _slotOwnerEnc[id][slot] = ownerEnc;
        }

        _ownerSlotCountByCipher[id][ownerKey] = currentCount + requested;
        r.soldSlots += requested;

        emit DarkpoolJoined(id, slotIds, msg.value);

        if (r.soldSlots == r.totalSlots) {
            r.status = RaffleStatus.FILLED;
            emit DarkpoolFilled(id, r.totalSlots);
            if (r.autoDraw) {
                _drawInternal(id, r);
            }
        }
    }

    /// @notice Dev helper: join using a plaintext owner address (NOT private in calldata).
    /// @dev Still stores owner in encrypted form in state, but calldata reveals the address.
    function unsafeJoinRaffleRelayedPlaintextOwner(
        string calldata raffleId,
        uint256[] calldata slotIds,
        uint256 amount,
        address token,
        address plaintextOwner
    ) external payable onlyRelayer {
        bytes memory dummy; // empty to avoid duplicated logic in the main path
        // Use trivial encryption on-chain (plaintext leaks via calldata).
        eaddress ownerEnc = FHE.asEaddress(plaintextOwner);
        // Build an "encryptedOwner" input is not possible here; we store directly.
        // So we re-implement the minimal join path inline:
        require(token == address(0), "ERC20Disabled");
        require(msg.value == amount, "BadPayment");
        require(slotIds.length > 0, "NoSlots");

        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.OPEN, "NotOpen");
        if (r.expiresAt != 0) {
            require(block.timestamp <= r.expiresAt, "RaffleExpired");
        }

        FHE.allowThis(ownerEnc);
        if (observer != address(0)) {
            FHE.allow(ownerEnc, observer);
        }

        uint256 requested = slotIds.length;
        uint256 remaining = r.totalSlots - r.soldSlots;
        require(requested <= remaining, "OverCapacity");

        bytes32 ownerKey = eaddress.unwrap(ownerEnc);
        uint256 currentCount = _ownerSlotCountByCipher[id][ownerKey];
        require(currentCount + requested <= r.maxSlotsPerWallet, "MaxSlotsPerWallet");

        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            require(slot >= 1 && slot <= r.totalSlots, "SlotOutOfRange");
            for (uint256 j = 0; j < i; j++) {
                require(slotIds[j] != slot, "DuplicateSlot");
            }
            require(!_slotTaken[id][slot], "SlotTaken");
        }

        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            _slotTaken[id][slot] = true;
            _slotOwnerEnc[id][slot] = ownerEnc;
        }

        _ownerSlotCountByCipher[id][ownerKey] = currentCount + requested;
        r.soldSlots += requested;
        emit DarkpoolJoined(id, slotIds, msg.value);

        if (r.soldSlots == r.totalSlots) {
            r.status = RaffleStatus.FILLED;
            emit DarkpoolFilled(id, r.totalSlots);
            if (r.autoDraw) {
                _drawInternal(id, r);
            }
        }

        // silence unused variable warning in some toolchains
        dummy;
    }

    // =============================================================
    // Draw + Claim
    // =============================================================

    function drawRaffle(string calldata raffleId) external onlyRelayer {
        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.FILLED, "NotFilled");
        _drawInternal(id, r);
    }

    /// @notice Claim prize to vault using encrypted owner proof.
    /// @dev No plaintext winner address is stored. Claim succeeds if `encryptedOwner` matches the stored ciphertext handle.
    function claimToVault(
        string calldata raffleId,
        address vault,
        bytes calldata encryptedOwner
    ) external onlyRelayer {
        require(vault != address(0), "BadVault");

        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.DRAWN, "NotDrawn");
        require(!r.claimed, "AlreadyClaimed");

        // Verify the provided ciphertext handle matches the stored winning slot owner.
        eaddress claimOwner = FHE.asEaddress(encryptedOwner);
        eaddress winnerOwner = _slotOwnerEnc[id][r.winnerSlot];
        require(FHE.isInitialized(winnerOwner), "WinnerMissing");
        require(eaddress.unwrap(claimOwner) == eaddress.unwrap(winnerOwner), "BadOwnerCipher");

        r.claimed = true;
        _mintPrizeToVault(id, r, vault, encryptedOwner);
    }

    /// @notice Dev helper: claim prize to vault using a plaintext owner address (NOT private in calldata).
    /// @dev Useful for testnets when encrypted input generation is not wired yet.
    function unsafeClaimToVaultPlaintextOwner(
        string calldata raffleId,
        address vault,
        address plaintextOwner
    ) external onlyRelayer {
        require(vault != address(0), "BadVault");
        require(plaintextOwner != address(0), "BadOwner");

        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.DRAWN, "NotDrawn");
        require(!r.claimed, "AlreadyClaimed");

        eaddress claimOwner = FHE.asEaddress(plaintextOwner);
        eaddress winnerOwner = _slotOwnerEnc[id][r.winnerSlot];
        require(FHE.isInitialized(winnerOwner), "WinnerMissing");
        require(eaddress.unwrap(claimOwner) == eaddress.unwrap(winnerOwner), "BadOwnerCipher");

        r.claimed = true;
        // Mint to vault and finalize using unsafe path (plaintext leaks via calldata).
        _mintPrizeToVaultUnsafeFinalize(id, r, vault, plaintextOwner);
    }

    /// @notice Optional: claim prize to a public address (reveals recipient).
    function claimToAddress(
        string calldata raffleId,
        address to,
        bytes calldata encryptedOwner
    ) external onlyRelayer {
        require(to != address(0), "BadTo");

        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.DRAWN, "NotDrawn");
        require(!r.claimed, "AlreadyClaimed");

        eaddress claimOwner = FHE.asEaddress(encryptedOwner);
        eaddress winnerOwner = _slotOwnerEnc[id][r.winnerSlot];
        require(FHE.isInitialized(winnerOwner), "WinnerMissing");
        require(eaddress.unwrap(claimOwner) == eaddress.unwrap(winnerOwner), "BadOwnerCipher");

        r.claimed = true;
        _mintPrizeToAddress(id, r, to);
    }

    /// @notice Dev helper: claim prize to a public address using a plaintext owner address (NOT private in calldata).
    function unsafeClaimToAddressPlaintextOwner(
        string calldata raffleId,
        address to,
        address plaintextOwner
    ) external onlyRelayer {
        require(to != address(0), "BadTo");
        require(plaintextOwner != address(0), "BadOwner");

        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.DRAWN, "NotDrawn");
        require(!r.claimed, "AlreadyClaimed");

        eaddress claimOwner = FHE.asEaddress(plaintextOwner);
        eaddress winnerOwner = _slotOwnerEnc[id][r.winnerSlot];
        require(FHE.isInitialized(winnerOwner), "WinnerMissing");
        require(eaddress.unwrap(claimOwner) == eaddress.unwrap(winnerOwner), "BadOwnerCipher");

        r.claimed = true;
        _mintPrizeToAddress(id, r, to);
    }

    // =============================================================
    // View helpers (for UI/UX)
    // =============================================================

    function getRaffleLoad(
        string calldata raffleId
    ) external view returns (
        uint256 totalSlots,
        uint256 soldSlots,
        uint256 maxSlotsPerWallet,
        uint8 status,
        uint64 expiresAt
    ) {
        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        return (r.totalSlots, r.soldSlots, r.maxSlotsPerWallet, uint8(r.status), r.expiresAt);
    }

    function getRaffleResult(
        string calldata raffleId
    ) external view returns (uint256 winnerSlot, uint8 status, bool claimed) {
        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        return (r.winnerSlot, uint8(r.status), r.claimed);
    }

    function checkSlotsAvailability(
        string calldata raffleId,
        uint256[] calldata slotIds
    ) external view returns (uint256[] memory unavailable) {
        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");

        uint256 len = slotIds.length;
        uint256[] memory tmp = new uint256[](len);
        uint256 count;

        for (uint256 i = 0; i < len; i++) {
            uint256 slot = slotIds[i];
            if (slot < 1 || slot > r.totalSlots || _slotTaken[id][slot]) {
                tmp[count] = slot;
                count++;
            }
        }

        unavailable = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            unavailable[i] = tmp[i];
        }
    }

    function getTakenSlotsInRange(
        string calldata raffleId,
        uint256 startSlot,
        uint256 endSlot
    ) external view returns (uint256[] memory taken) {
        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(startSlot >= 1 && endSlot >= startSlot && endSlot <= r.totalSlots, "BadRange");

        uint256 span = endSlot - startSlot + 1;
        uint256[] memory tmp = new uint256[](span);
        uint256 count;
        for (uint256 s = startSlot; s <= endSlot; s++) {
            if (_slotTaken[id][s]) {
                tmp[count] = s;
                count++;
            }
        }
        taken = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            taken[i] = tmp[i];
        }
    }

    function getAvailableSlotsInRange(
        string calldata raffleId,
        uint256 startSlot,
        uint256 endSlot
    ) external view returns (uint256[] memory available) {
        bytes32 id = keccak256(bytes(raffleId));
        RaffleCfg storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(startSlot >= 1 && endSlot >= startSlot && endSlot <= r.totalSlots, "BadRange");

        uint256 span = endSlot - startSlot + 1;
        uint256[] memory tmp = new uint256[](span);
        uint256 count;
        for (uint256 s = startSlot; s <= endSlot; s++) {
            if (!_slotTaken[id][s]) {
                tmp[count] = s;
                count++;
            }
        }
        available = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            available[i] = tmp[i];
        }
    }

    // =============================================================
    // Internals
    // =============================================================

    function _drawInternal(bytes32 id, RaffleCfg storage r) internal {
        uint256 winnerSlot = (uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, id))) % r.totalSlots) + 1;
        require(_slotTaken[id][winnerSlot], "WinnerSlotEmpty");

        r.winnerSlot = winnerSlot;
        r.status = RaffleStatus.DRAWN;

        emit DarkpoolDrawn(id, winnerSlot);

        if (r.autoClaim && !r.claimed) {
            // Auto-claim requires a provided encrypted owner proof, so we skip it in relayer-first mode.
            // Keep autoClaim=false for this contract; use claimToVault/claimToAddress via relayer.
        }
    }

    function _mintPrizeToVault(
        bytes32 id,
        RaffleCfg storage r,
        address vault,
        bytes calldata encryptedOwner
    ) internal {
        require(r.collection != address(0), "NoCollection");
        require(r.prizeType == PrizeTokenType.ERC721, "OnlyERC721");

        uint256 amountToMint = r.prizeAmount == 0 ? 1 : r.prizeAmount;
        for (uint256 i = 0; i < amountToMint; i++) {
            uint256 mintedId = ICollectionMintRelayed(r.collection).mintTo(vault, r.metadataUri);
            IMogateERC721VaultRelayed(vault).finalizeReceivedERC721(r.collection, mintedId, encryptedOwner);
            emit DarkpoolPrizeMinted(id, vault, mintedId, r.metadataUri);
        }
    }

    function _mintPrizeToVaultUnsafeFinalize(
        bytes32 id,
        RaffleCfg storage r,
        address vault,
        address plaintextOwner
    ) internal {
        require(r.collection != address(0), "NoCollection");
        require(r.prizeType == PrizeTokenType.ERC721, "OnlyERC721");

        uint256 amountToMint = r.prizeAmount == 0 ? 1 : r.prizeAmount;
        for (uint256 i = 0; i < amountToMint; i++) {
            uint256 mintedId = ICollectionMintRelayed(r.collection).mintTo(vault, r.metadataUri);
            IMogateERC721VaultRelayed(vault).unsafeFinalizeReceivedERC721(r.collection, mintedId, plaintextOwner);
            emit DarkpoolPrizeMinted(id, vault, mintedId, r.metadataUri);
        }
    }

    function _mintPrizeToAddress(
        bytes32 id,
        RaffleCfg storage r,
        address to
    ) internal {
        require(r.collection != address(0), "NoCollection");
        require(r.prizeType == PrizeTokenType.ERC721, "OnlyERC721");

        uint256 amountToMint = r.prizeAmount == 0 ? 1 : r.prizeAmount;
        for (uint256 i = 0; i < amountToMint; i++) {
            uint256 mintedId = ICollectionMintRelayed(r.collection).mintTo(to, r.metadataUri);
            emit DarkpoolPrizeMinted(id, to, mintedId, r.metadataUri);
        }
    }
}
