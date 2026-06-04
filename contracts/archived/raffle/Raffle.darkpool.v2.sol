// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import { FHE, euint32 } from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Minimal interface for the external NFT collection used for prizes.
interface ICollectionMintV2 {
    function mintTo(address to, string calldata uri) external returns (uint256);
}

/// @title Mogate Raffle V2 (Darkpool Foundation on Fhenix/CoFHE)
/// @notice New version contract: keeps V1 raffle mechanics and adds encrypted mirrors
/// for ticket counts, sold slots, and winner slot.
/// @dev Slot IDs remain plaintext in this V2 foundation for deterministic validation.
contract RaffleDarkpoolV2 is Ownable {
    constructor() Ownable(msg.sender) {}

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

    struct DarkpoolRaffle {
        string raffleId;
        address organizer;
        uint256 totalSlots;
        uint256 maxSlotsPerAddress;
        uint256 slotPriceWei;
        string metadataUri;
        address collection;
        bool autoDraw;
        bool autoClaim;
        PrizeTokenType prizeType;
        uint256 prizeAmount;
        uint64 createdAt;
        uint64 expiresAt;
        RaffleStatus status;
        uint256 soldSlots;
        uint256 winnerSlot;
        address winner;
        bool claimed;
    }

    mapping(bytes32 => DarkpoolRaffle) private _raffles;
    mapping(bytes32 => mapping(uint256 => address)) private _slotOwner;
    mapping(bytes32 => mapping(address => uint256)) private _userSlotCount;
    mapping(bytes32 => mapping(address => uint256[])) private _userSlots;
    mapping(bytes32 => mapping(address => uint256)) private _userPaid;
    mapping(address => string[]) private _userRaffles;

    // Encrypted mirrors for privacy-facing integrations.
    mapping(bytes32 => euint32) private _encSoldSlots;
    mapping(bytes32 => euint32) private _encWinnerSlot;
    mapping(bytes32 => mapping(address => euint32)) private _encUserSlotCount;

    uint256 public refundFeeBps = 500;

    event DarkpoolRaffleHosted(bytes32 indexed id, string raffleId, address indexed organizer);
    event DarkpoolRaffleJoined(bytes32 indexed id, address indexed payer, uint256[] slots, uint256 paidAmount);
    event DarkpoolRaffleFilled(bytes32 indexed id, uint256 totalSlots);
    event DarkpoolRaffleDrawn(bytes32 indexed id, uint256 winnerSlot, address indexed winner);
    event DarkpoolRafflePrizeMinted(bytes32 indexed id, address indexed to, uint256 tokenId, string metadataUri);
    event DarkpoolRaffleProceedsWithdrawn(address indexed to, uint256 amount);
    event RefundClaimed(bytes32 indexed id, address indexed user, uint256 refundAmount, uint256 feeAmount);

    function hostRaffle(
        string calldata raffleId,
        uint256 totalSlots,
        uint256 maxSlotsPerAddress,
        uint256 slotPriceWei, // remove
        string calldata metadataUri,
        address collection,
        PrizeTokenType prizeType,
        uint256 prizeAmount,
        bool autoDraw,
        bool autoClaim,
        uint64 expiresAt
        //signature
    ) external returns (bytes32 id) {
        require(totalSlots > 0, "TotalSlotsZero");
        require(maxSlotsPerAddress > 0, "MaxSlotsZero");

        id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length == 0, "RaffleExists");

        r.raffleId = raffleId;
        r.organizer = msg.sender;
        r.totalSlots = totalSlots;
        r.maxSlotsPerAddress = maxSlotsPerAddress;
        r.slotPriceWei = slotPriceWei;
        r.metadataUri = metadataUri;
        r.collection = collection;
        r.autoDraw = autoDraw;
        r.autoClaim = autoClaim;
        r.prizeType = prizeType;
        r.prizeAmount = prizeAmount;
        r.createdAt = uint64(block.timestamp);
        r.expiresAt = expiresAt;
        r.status = RaffleStatus.OPEN;
        r.soldSlots = 0;

        _encSoldSlots[id] = FHE.asEuint32(0);
        FHE.allowThis(_encSoldSlots[id]);
        FHE.allow(_encSoldSlots[id], msg.sender);

        emit DarkpoolRaffleHosted(id, raffleId, msg.sender);
    }

    function joinRaffle(
        string calldata raffleId,
        uint256[] calldata slotIds
    ) external payable {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];

        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.OPEN, "NotOpen");
        require(slotIds.length > 0, "NoSlots");
        if (r.expiresAt != 0) {
            require(block.timestamp <= r.expiresAt, "RaffleExpired");
        }

        uint256 requested = slotIds.length;
        uint256 remaining = r.totalSlots - r.soldSlots;
        require(requested <= remaining, "OverCapacity");

        uint256 current = _userSlotCount[id][msg.sender];
        require(current + requested <= r.maxSlotsPerAddress, "MaxSlotsPerAddress");

        uint256 requiredPayment = r.slotPriceWei * requested;
        require(msg.value == requiredPayment, "BadPayment");

        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            require(slot >= 1 && slot <= r.totalSlots, "SlotOutOfRange");

            for (uint256 j = 0; j < i; j++) {
                require(slotIds[j] != slot, "DuplicateSlot");
            }
            require(_slotOwner[id][slot] == address(0), "SlotTaken");
        }

        if (current == 0) {
            _userRaffles[msg.sender].push(r.raffleId);
        }

        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            _slotOwner[id][slot] = msg.sender;
            _userSlots[id][msg.sender].push(slot);
        }

        _userSlotCount[id][msg.sender] = current + requested;
        _userPaid[id][msg.sender] += msg.value;
        r.soldSlots += requested;

        _syncEncryptedUserSlotCount(id, msg.sender, requested);
        _syncEncryptedSoldSlots(id, requested);

        emit DarkpoolRaffleJoined(id, msg.sender, slotIds, msg.value);

        if (r.soldSlots == r.totalSlots) {
            r.status = RaffleStatus.FILLED;
            emit DarkpoolRaffleFilled(id, r.totalSlots);
            if (r.autoDraw) {
                _drawInternal(id, r);
            }
        }
    }

    function drawRaffle(string calldata raffleId) external {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(msg.sender == r.organizer || msg.sender == owner(), "NotOrganizer");
        require(r.status == RaffleStatus.FILLED, "NotFilled");
        _drawInternal(id, r);
    }

    function claim(string calldata raffleId) external {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.DRAWN, "NotDrawn");
        require(!r.claimed, "AlreadyClaimed");
        require(msg.sender == r.winner, "NotWinner");

        r.claimed = true;
        _mintPrize(id, r, msg.sender);
    }

    function claimRefund(string calldata raffleId) external {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.expiresAt != 0 && block.timestamp > r.expiresAt, "NotExpired");
        require(r.soldSlots < r.totalSlots, "RaffleFilled");
        require(r.status == RaffleStatus.OPEN || r.status == RaffleStatus.CANCELLED, "BadStatus");

        uint256 paid = _userPaid[id][msg.sender];
        require(paid > 0, "NothingToRefund");

        if (r.status == RaffleStatus.OPEN) {
            r.status = RaffleStatus.CANCELLED;
        }

        _userPaid[id][msg.sender] = 0;

        uint256 refundAmount = (paid * (10_000 - refundFeeBps)) / 10_000;
        uint256 feeAmount = paid - refundAmount;

        (bool ok, ) = msg.sender.call{value: refundAmount}("");
        require(ok, "RefundFailed");

        emit RefundClaimed(id, msg.sender, refundAmount, feeAmount);
    }

    function withdrawProceeds(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "InvalidRecipient");
        require(amount <= address(this).balance, "InsufficientBalance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "TransferFailed");
        emit DarkpoolRaffleProceedsWithdrawn(to, amount);
    }

    function setRefundFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 10_000, "FeeTooHigh");
        refundFeeBps = newFeeBps;
    }

    function getRaffleLoad(
        string calldata raffleId
    ) external view returns (
        uint256 totalSlots,
        uint256 soldSlots,
        uint256 slotPriceWei,
        uint8 status,
        uint64 expiresAt
    ) {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        return (r.totalSlots, r.soldSlots, r.slotPriceWei, uint8(r.status), r.expiresAt);
    }

    function getRaffleResult(
        string calldata raffleId
    ) external view returns (
        uint256 winnerSlot,
        address winner,
        uint8 status,
        bool claimed
    ) {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        return (r.winnerSlot, r.winner, uint8(r.status), r.claimed);
    }

    function getUserRaffles(address user) external view returns (string[] memory) {
        string[] storage list = _userRaffles[user];
        string[] memory out = new string[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            out[i] = list[i];
        }
        return out;
    }

    function getUserRaffleSlots(
        string calldata raffleId,
        address user
    ) external view returns (uint256[] memory) {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");

        uint256[] storage slots = _userSlots[id][user];
        uint256[] memory out = new uint256[](slots.length);
        for (uint256 i = 0; i < slots.length; i++) {
            out[i] = slots[i];
        }
        return out;
    }

    function getMyEncryptedSlotCount(
        string calldata raffleId
    ) external returns (euint32) {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");

        euint32 value = _encUserSlotCount[id][msg.sender];
        require(FHE.isInitialized(value), "EncryptedCountMissing");
        FHE.allowSender(value);
        return value;
    }

    function getEncryptedSoldSlots(
        string calldata raffleId
    ) external returns (euint32) {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");

        euint32 value = _encSoldSlots[id];
        require(FHE.isInitialized(value), "EncryptedSoldMissing");
        FHE.allowSender(value);
        return value;
    }

    function getEncryptedWinnerSlot(
        string calldata raffleId
    ) external returns (euint32) {
        bytes32 id = keccak256(bytes(raffleId));
        DarkpoolRaffle storage r = _raffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == RaffleStatus.DRAWN, "NotDrawn");

        euint32 value = _encWinnerSlot[id];
        require(FHE.isInitialized(value), "EncryptedWinnerMissing");
        FHE.allowSender(value);
        return value;
    }

    function _drawInternal(bytes32 id, DarkpoolRaffle storage r) internal {
        uint256 winnerSlot = (uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, id))) % r.totalSlots) + 1;
        address winner = _slotOwner[id][winnerSlot];
        require(winner != address(0), "NoWinner");

        r.winnerSlot = winnerSlot;
        r.winner = winner;
        r.status = RaffleStatus.DRAWN;

        _encWinnerSlot[id] = FHE.asEuint32(winnerSlot);
        FHE.allowThis(_encWinnerSlot[id]);
        FHE.allow(_encWinnerSlot[id], winner);
        FHE.allow(_encWinnerSlot[id], r.organizer);

        emit DarkpoolRaffleDrawn(id, winnerSlot, winner);

        if (r.autoClaim && !r.claimed) {
            r.claimed = true;
            _mintPrize(id, r, winner);
        }
    }

    function _syncEncryptedUserSlotCount(bytes32 id, address user, uint256 delta) internal {
        euint32 current = _encUserSlotCount[id][user];
        if (!FHE.isInitialized(current)) {
            current = FHE.asEuint32(0);
            FHE.allowThis(current);
        }

        euint32 increment = FHE.asEuint32(delta);
        FHE.allowThis(increment);

        euint32 updated = FHE.add(current, increment);
        FHE.allowThis(updated);
        FHE.allow(updated, user);

        _encUserSlotCount[id][user] = updated;
    }

    function _syncEncryptedSoldSlots(bytes32 id, uint256 delta) internal {
        euint32 current = _encSoldSlots[id];
        if (!FHE.isInitialized(current)) {
            current = FHE.asEuint32(0);
            FHE.allowThis(current);
        }

        euint32 increment = FHE.asEuint32(delta);
        FHE.allowThis(increment);

        euint32 updated = FHE.add(current, increment);
        FHE.allowThis(updated);
        FHE.allow(updated, owner());

        _encSoldSlots[id] = updated;
    }

    function _mintPrize(bytes32 id, DarkpoolRaffle storage r, address to) internal {
        require(r.collection != address(0), "NoCollection");

        PrizeTokenType prizeType = r.prizeType == PrizeTokenType.NONE
            ? PrizeTokenType.ERC721
            : r.prizeType;
        uint256 amountToMint = r.prizeAmount == 0 ? 1 : r.prizeAmount;

        if (prizeType == PrizeTokenType.ERC721) {
            for (uint256 i = 0; i < amountToMint; i++) {
                uint256 mintedId = ICollectionMintV2(r.collection).mintTo(to, r.metadataUri);
                emit DarkpoolRafflePrizeMinted(id, to, mintedId, r.metadataUri);
            }
            return;
        }

        if (prizeType == PrizeTokenType.ERC1155) revert("ERC1155PrizeNotImplemented");
        if (prizeType == PrizeTokenType.ERC404) revert("ERC404PrizeNotImplemented");
        revert("UnknownPrizeType");
    }
}
