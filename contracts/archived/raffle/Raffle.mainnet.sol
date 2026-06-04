// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Minimal interface for the external NFT collection used for prizes.
interface ICollectionMint {
    /// @notice Mint a token with a specific `tokenId` and metadata URI to `to`.
    function mintWithTokenId(
        address to,
        uint256 tokenId,
        string calldata uri
    ) external returns (uint256);
    /// @notice Mint a token with a specific `tokenId` and metadata URI to `to`.
    function mintTo(
        address to,
        string calldata uri
    ) external returns (uint256);
}

/// @title Multi-raffle engine (chain-agnostic spec, EVM implementation)
/// @notice Implements the RAFFLE.md logic using native ETH payments and an
/// external NFT collection for prizes.
/// @dev Each raffle is identified by a string `raffleId` (hashed to bytes32
/// for storage) and uses explicit slot numbers owned by participant addresses.

contract Raffle is Ownable, EIP712 {
    constructor()
        Ownable(msg.sender)
        EIP712("MogateRaffle", "1")
    {}

    // =============================================================
    // Core types and storage
    // =============================================================

    /// @notice High-level status for each raffle.
    enum MultiRaffleStatus {
        OPEN,
        FILLED,
        DRAWN,
        CANCELLED
    }

    /// @notice Type of prize token.
    enum PrizeTokenType {
        NONE,
        ERC721,
        ERC1155,
        ERC404
    }

    /// @notice Per-raffle configuration and runtime state.
    struct MultiRaffle {
        string raffleId;
        uint256 totalSlots;
        uint256 maxSlotsPerAddress;
        string metadataUri;
        address collection;
        bool premintContract;
        bool premint;
        /// @notice Whether the raffle should automatically draw a winner when all slots are sold.
        bool autoDraw;
        /// @notice Whether the prize should be automatically claimed (minted) when the raffle is drawn.
        bool autoClaim;
        /// @notice Type of prize token (ERC721 / ERC1155 / ERC404 / NONE).
        PrizeTokenType prizeType;
        /// @notice Amount of prize tokens to mint to the winner (for ERC721 this is normally 1).
        uint256 prizeAmount;
        uint64 createdAt;
        uint64 expiresAt;
        MultiRaffleStatus status;
        uint256 soldSlots;
        uint256 winnerSlot;
        address winner;
        bool claimed;
    }

    // raffleId hash => raffle data
    mapping(bytes32 => MultiRaffle) private _multiRaffles;
    mapping(bytes32 => mapping(uint256 => address)) private _slotOwnerMulti;
    mapping(bytes32 => mapping(address => uint256)) private _userSlotCountMulti;
    mapping(bytes32 => mapping(address => uint256[])) private _userSlotsMulti;
    mapping(bytes32 => mapping(address => uint256)) private _userPaidMulti;
    mapping(address => string[]) private _userRafflesMulti;

    /// @notice Refund fee in basis points (out of 10_000). Default is 500 = 5%.
    uint256 public refundFeeBps = 500;

    /// @notice Backend signer that authorizes safe actions.
    address public backendSigner;
    /// @notice Tracks which EIP-712 permits have already been consumed.
    mapping(bytes32 => bool) public usedPermits;

    bytes32 private constant HOST_RAFFLE_TYPEHASH = keccak256(
        "HostRaffle(string raffleId,uint256 totalSlots,uint256 maxSlotsPerAddress,string metadataUri,address collection,bool premintContract,bool premint,uint8 prizeType,uint256 prizeAmount,bool autoDraw,bool autoClaim,uint64 expiresAt,address organizer)"
    );
    bytes32 private constant JOIN_RAFFLE_TYPEHASH = keccak256(
        "JoinRaffle(string raffleId,uint256[] slotIds,uint256 amount,address token,address payer)"
    );
    bytes32 private constant HOST_AND_JOIN_RAFFLE_TYPEHASH = keccak256(
        "HostAndJoinRaffle(string raffleId,uint256 totalSlots,uint256 maxSlotsPerAddress,string metadataUri,address collection,bool premintContract,bool premint,uint8 prizeType,uint256 prizeAmount,bool autoDraw,bool autoClaim,uint64 expiresAt,uint256[] slotIds,uint256 amount,address token,uint256 bonusFreeSlots,address payer)"
    );

    function _statusToString(MultiRaffleStatus s) internal pure returns (string memory) {
        if (s == MultiRaffleStatus.OPEN) return "OPEN";
        if (s == MultiRaffleStatus.FILLED) return "FILLED";
        if (s == MultiRaffleStatus.DRAWN) return "DRAWN";
        return "CANCELLED";
    }

    function _prizeTypeToString(PrizeTokenType t) internal pure returns (string memory) {
        if (t == PrizeTokenType.ERC721) return "ERC721";
        if (t == PrizeTokenType.ERC1155) return "ERC1155";
        if (t == PrizeTokenType.ERC404) return "ERC404";
        return "NONE";
    }

    // =============================================================
    // Events
    // =============================================================

    event MultiRaffleHosted(bytes32 indexed id, string raffleId, address indexed organizer);
    event MultiRaffleJoined(bytes32 indexed id, address indexed payer, uint256[] slots, uint256 paidAmount);
    event MultiRaffleFilled(bytes32 indexed id, uint256 totalSlots);
    event MultiRaffleDrawn(bytes32 indexed id, uint256 winnerSlot, address indexed winner);
    event MultiRafflePrizeMinted(bytes32 indexed id, address indexed to, uint256 tokenId, string metadataUri);
    event MultiRaffleProceedsWithdrawn(address indexed to, uint256 amount);
    event BackendSignerUpdated(address indexed signer);

    // =============================================================
    // External host/join (safe variants - signature based)
    // =============================================================

    /// @notice Host a raffle with off-chain pricing/signature (safe variant).
    function hostRaffle(
        string calldata raffleId,
        uint256 totalSlots,
        uint256 maxSlotsPerAddress,
        string calldata metadataUri,
        address collection,
        bool premintContract,
        bool premint,
        PrizeTokenType prizeType,
        uint256 prizeAmount,
        bool autoDraw,
        bool autoClaim,
        uint64 expiresAt,
        bytes calldata signature
    ) external returns (bytes32 id) {
        bytes32 digest = _hashHostRaffle(
            raffleId,
            totalSlots,
            maxSlotsPerAddress,
            metadataUri,
            collection,
            premintContract,
            premint,
            prizeType,
            prizeAmount,
            autoDraw,
            autoClaim,
            expiresAt,
            msg.sender
        );
        _consumePermit(digest, signature);

        id = _createRaffle(
            raffleId,
            totalSlots,
            maxSlotsPerAddress,
            metadataUri,
            collection,
            premintContract,
            premint,
            prizeType,
            prizeAmount,
            autoDraw,
            autoClaim,
            expiresAt
        );
    }

    // =============================================================
    // External host/join (unsafe variants - no signature)
    // =============================================================

    // /// @notice Create a new raffle with the specified parameters (unsafe, no signature).
    // /// @dev Reverts if a raffle with the same `raffleId` already exists.
    // /// Sets status to OPEN and resets counters.
    // function unsafeHostRaffle(
    //     string calldata raffleId,
    //     uint256 totalSlots,
    //     uint256 maxSlotsPerAddress,
    //     string calldata metadataUri,
    //     address collection,
    //     bool premintContract,
    //     bool premint,
    //     PrizeTokenType prizeType,
    //     uint256 prizeAmount,
    //     bool autoDraw,
    //     bool autoClaim,
    //     uint64 expiresAt
    // ) external returns (bytes32 id) {
    //     id = _createRaffle(
    //         raffleId,
    //         totalSlots,
    //         maxSlotsPerAddress,
    //         metadataUri,
    //         collection,
    //         premintContract,
    //         premint,
    //         prizeType,
    //         prizeAmount,
    //         autoDraw,
    //         autoClaim,
    //         expiresAt
    //     );
    // }

    /// @notice Join an existing raffle by purchasing specific slot IDs (safe variant).
    function joinRaffle(
        string calldata raffleId,
        uint256[] calldata slotIds,
        uint256 amount,
        address token,
        bytes calldata signature
    ) external payable {
        require(slotIds.length > 0, "NoSlots");

        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == MultiRaffleStatus.OPEN, "NotOpen");
        if (r.expiresAt != 0) {
            require(block.timestamp <= r.expiresAt, "RaffleExpired");
        }

        bytes32 digest = _hashJoinRaffle(
            raffleId,
            slotIds,
            amount,
            token,
            msg.sender
        );
        _consumePermit(digest, signature);

        if (amount > 0) {
            if (token == address(0)) {
                _handleNativePayment(id, msg.sender, amount);
            } else {
                revert("ERC20Disabled");
            }
        }

        _joinRaffle(id, r, slotIds, msg.sender, 0, amount);
    }

    // /// @notice Join an existing raffle by purchasing specific slot IDs (unsafe, no signature).
    // /// @dev Payment amount and token are provided by the off-chain backend.
    // /// Reverts if raffle is not OPEN, expired, or any slot is invalid/taken.
    // function unsafeJoinRaffle(
    //     string calldata raffleId,
    //     uint256[] calldata slotIds,
    //     uint256 amount,
    //     address token
    // ) external payable {
    //     require(slotIds.length > 0, "NoSlots");

    //     bytes32 id = keccak256(bytes(raffleId));
    //     MultiRaffle storage r = _multiRaffles[id];
    //     require(bytes(r.raffleId).length != 0, "RaffleNotFound");
    //     require(r.status == MultiRaffleStatus.OPEN, "NotOpen");
    //     if (r.expiresAt != 0) {
    //         require(block.timestamp <= r.expiresAt, "RaffleExpired");
    //     }

    //     if (amount > 0) {
    //         if (token == address(0)) {
    //             _handleNativePayment(id, msg.sender, amount);
    //         } else {
    //             // TODO: support ERC20 tokens in the future
    //             // IERC20(token).transferFrom(msg.sender, address(this), amount);
    //             revert("ERC20Disabled");
    //         }
    //     }

    //     _joinRaffle(id, r, slotIds, msg.sender, 0, amount);
    // }

    /// @notice Host and join a raffle in a single call (safe variant).
    function hostAndJoinRaffle(
        string calldata raffleId,
        uint256 totalSlots,
        uint256 maxSlotsPerAddress,
        string calldata metadataUri,
        address collection,
        bool premintContract,
        bool premint,
        PrizeTokenType prizeType,
        uint256 prizeAmount,
        bool autoDraw,
        bool autoClaim,
        uint64 expiresAt,
        uint256[] calldata slotIds,
        uint256 amount,
        address token,
        uint256 bonusFreeSlots,
        bytes calldata signature
    ) external payable returns (bytes32 id) {
        bytes32 digest = _hashHostAndJoinRaffle(
            raffleId,
            totalSlots,
            maxSlotsPerAddress,
            metadataUri,
            collection,
            premintContract,
            premint,
            prizeType,
            prizeAmount,
            autoDraw,
            autoClaim,
            expiresAt,
            slotIds,
            amount,
            token,
            bonusFreeSlots,
            msg.sender
        );
        _consumePermit(digest, signature);

        id = _createRaffle(
            raffleId,
            totalSlots,
            maxSlotsPerAddress,
            metadataUri,
            collection,
            premintContract,
            premint,
            prizeType,
            prizeAmount,
            autoDraw,
            autoClaim,
            expiresAt
        );

        MultiRaffle storage r = _multiRaffles[id];

        if (amount > 0) {
            if (token == address(0)) {
                _handleNativePayment(id, msg.sender, amount);
            } else {
                revert("ERC20Disabled");
            }
        }

        _joinRaffle(id, r, slotIds, msg.sender, bonusFreeSlots, amount);
    }

    // /// @notice Convenience helper that both hosts and joins a raffle in one tx (unsafe, no signature).
    // /// @dev The first `min(bonusFreeSlots, slotIds.length)` slots are treated as free off-chain.
    // function unsafeHostAndJoinRaffle(
    //     string calldata raffleId,
    //     uint256 totalSlots,
    //     uint256 maxSlotsPerAddress,
    //     string calldata metadataUri,
    //     address collection,
    //     bool premintContract,
    //     bool premint,
    //     PrizeTokenType prizeType,
    //     uint256 prizeAmount,
    //     bool autoDraw,
    //     bool autoClaim,
    //     uint64 expiresAt,
    //     uint256[] calldata slotIds,
    //     uint256 amount,
    //     address token,
    //     uint256 bonusFreeSlots
    // ) external payable returns (bytes32 id) {
    //     id = _createRaffle(
    //         raffleId,
    //         totalSlots,
    //         maxSlotsPerAddress,
    //         metadataUri,
    //         collection,
    //         premintContract,
    //         premint,
    //         prizeType,
    //         prizeAmount,
    //         autoDraw,
    //         autoClaim,
    //         expiresAt
    //     );

    //     MultiRaffle storage r = _multiRaffles[id];

    //     if (amount > 0) {
    //         if (token == address(0)) {
    //             _handleNativePayment(id, msg.sender, amount);
    //         } else {
    //             // TODO: support ERC20 tokens in the future
    //             // IERC20(token).transferFrom(msg.sender, address(this), amount);
    //             revert("ERC20Disabled");
    //         }
    //     }

    //     _joinRaffle(id, r, slotIds, msg.sender, bonusFreeSlots, amount);
    // }

    // =============================================================
    // External prize + treasury + refund
    // =============================================================

    /// @notice Claim the prize for a raffle where the caller is the recorded winner.
    function claim(string calldata raffleId) external {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == MultiRaffleStatus.DRAWN, "NotDrawn");
        require(!r.claimed, "AlreadyClaimed");
        require(msg.sender == r.winner, "NotWinner");

        _mintPrize(id, r, msg.sender);
        r.claimed = true;
    }

    /// @notice Admin function (or backend) to manually execute raffle draw for a filled raffle.
    /// @dev Useful when autoDraw is disabled to avoid pushing gas cost to the last joiner.
    function drawRaffle(string calldata raffleId) external {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.status == MultiRaffleStatus.FILLED, "NotFilled");
        
        _endRaffleInternal(id, r);
    }

    /// @notice Withdraw native token proceeds accumulated in this contract.
    /// @param to Recipient address.
    /// @param amount Amount of wei to withdraw.
    function withdrawProceeds(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "InvalidRecipient");
        require(amount <= address(this).balance, "InsufficientBalance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "TransferFailed");
        emit MultiRaffleProceedsWithdrawn(to, amount);
    }

    // =============================================================
    // View helpers
    // =============================================================

    /// @notice Return comprehensive information for a raffle.
    /// @return totalSlots Total number of slots.
    /// @return soldSlots Number of slots sold.
    /// @return maxSlotsPerAddress Maximum slots per address.
    /// @return metadataUri Metadata URI for the raffle.
    /// @return collection NFT collection address for prizes.
    /// @return premintContract Whether collection uses premint contract.
    /// @return premint Whether prize is preminted.
    /// @return autoDraw Whether the raffle auto-draws when all slots are sold.
    /// @return autoClaim Whether prize auto-claims (mints) on draw.
    /// @return createdAt Creation timestamp (UNIX).
    /// @return expiresAt Expiration timestamp (UNIX, 0 = no expiry).
    /// @return status Raffle status as uint8.
    /// @return statusString Raffle status as string (e.g. "OPEN", "DRAWN").
    /// @return winnerSlot Winning slot number (0 = not drawn).
    /// @return winner Winner address (zero address = not drawn).
    /// @return prizeAmount Amount of NFTs awarded.
    /// @return prizeType Prize token type as uint8.
    /// @return prizeTypeString Prize token type as string (e.g. "ERC721").
    /// @return claimed Whether prize has been claimed.
    function getRaffleLoadDetail(
        string calldata raffleId
    ) external view returns (
        uint256 totalSlots,
        uint256 soldSlots,
        uint256 maxSlotsPerAddress,
        string memory metadataUri,
        address collection,
        bool premintContract,
        bool premint,
        bool autoDraw,
        bool autoClaim,
        uint64 createdAt,
        uint64 expiresAt,
        uint8 status,
        string memory statusString,
        uint256 winnerSlot,
        address winner,
        uint256 prizeAmount,
        uint8 prizeType,
        string memory prizeTypeString,
        bool claimed
    ) {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");

        string memory statusStr = _statusToString(r.status);
        string memory prizeTypeStr = _prizeTypeToString(r.prizeType);

        return (
            r.totalSlots,
            r.soldSlots,
            r.maxSlotsPerAddress,
            r.metadataUri,
            r.collection,
            r.premintContract,
            r.premint,
            r.autoDraw,
            r.autoClaim,
            r.createdAt,
            r.expiresAt,
            uint8(r.status),
            statusStr,
            r.winnerSlot,
            r.winner,
            r.prizeAmount,
            uint8(r.prizeType),
            prizeTypeStr,
            r.claimed
        );
    }



    // todo: we can make it into pagination later
    /// @notice Return comprehensive information for multiple raffles in a single call.
    /// @dev All returned arrays have the same length as `raffleIds` and are index-aligned.
    function getRafflesLoadDetail(
        string[] calldata raffleIds
    )
        external
        view
        returns (
            uint256[] memory totalSlots,
            uint256[] memory soldSlots,
            uint256[] memory maxSlotsPerAddress,
            string[] memory metadataUri,
            address[] memory collection,
            bool[] memory premintContract,
            bool[] memory premint,
            bool[] memory autoDraw,
            bool[] memory autoClaim,
            uint64[] memory createdAt,
            uint64[] memory expiresAt,
            uint8[] memory status,
            uint256[] memory winnerSlot,
            address[] memory winner,
            uint256[] memory prizeAmount,
            uint8[] memory prizeType,
            bool[] memory claimed
        )
    {
        uint256 len = raffleIds.length;
        totalSlots = new uint256[](len);
        soldSlots = new uint256[](len);
        maxSlotsPerAddress = new uint256[](len);
        metadataUri = new string[](len);
        collection = new address[](len);
        premintContract = new bool[](len);
        premint = new bool[](len);
        autoDraw = new bool[](len);
        autoClaim = new bool[](len);
        createdAt = new uint64[](len);
        expiresAt = new uint64[](len);
        status = new uint8[](len);
        winnerSlot = new uint256[](len);
        winner = new address[](len);
        prizeAmount = new uint256[](len);
        prizeType = new uint8[](len);
        claimed = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            bytes32 id = keccak256(bytes(raffleIds[i]));
            MultiRaffle storage r = _multiRaffles[id];
            require(bytes(r.raffleId).length != 0, "RaffleNotFound");

            totalSlots[i] = r.totalSlots;
            soldSlots[i] = r.soldSlots;
            maxSlotsPerAddress[i] = r.maxSlotsPerAddress;
            metadataUri[i] = r.metadataUri;
            collection[i] = r.collection;
            premintContract[i] = r.premintContract;
            premint[i] = r.premint;
            autoDraw[i] = r.autoDraw;
            autoClaim[i] = r.autoClaim;
            createdAt[i] = r.createdAt;
            expiresAt[i] = r.expiresAt;
            status[i] = uint8(r.status);
            winnerSlot[i] = r.winnerSlot;
            winner[i] = r.winner;
            prizeAmount[i] = r.prizeAmount;
            prizeType[i] = uint8(r.prizeType);
            claimed[i] = r.claimed;
        }
    }

    // /// @notice Check if joining specific slots will fill the raffle and trigger draw.
    // /// @return willFill True if joining these slots will fill the raffle.
    // /// @return willAutoDraw True if filling will trigger automatic draw (gas intensive).
    // /// @return remainingSlots Number of slots remaining before fill.
    // function checkJoinWillFill(
    //     string calldata raffleId,
    //     uint256 slotCount
    // ) external view returns (
    //     bool willFill,
    //     bool willAutoDraw,
    //     uint256 remainingSlots
    // ) {
    //     bytes32 id = keccak256(bytes(raffleId));
    //     MultiRaffle storage r = _multiRaffles[id];
    //     require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        
    //     remainingSlots = r.totalSlots - r.soldSlots;
    //     willFill = slotCount >= remainingSlots;
    //     willAutoDraw = willFill && !r.autoClaim;
        
    //     return (willFill, willAutoDraw, remainingSlots);
    // }

    /// @notice Return basic load information for multiple raffles in a single call.
    /// @dev All returned arrays have the same length as `raffleIds` and are index-aligned.
    function getRafflesLoad(
        string[] calldata raffleIds
    )
        external
        view
        returns (uint256[] memory totalSlots, uint256[] memory soldSlots, uint8[] memory status)
    {
        uint256 len = raffleIds.length;
        totalSlots = new uint256[](len);
        soldSlots = new uint256[](len);
        status = new uint8[](len);

        for (uint256 i = 0; i < len; i++) {
            bytes32 id = keccak256(bytes(raffleIds[i]));
            MultiRaffle storage r = _multiRaffles[id];
            require(bytes(r.raffleId).length != 0, "RaffleNotFound");
            totalSlots[i] = r.totalSlots;
            soldSlots[i] = r.soldSlots;
            status[i] = uint8(r.status);
        }
    }

    /// @notice Return winner and prize information for a raffle.
    /// @return winnerSlot Winning slot number (0 = not drawn).
    /// @return winner Winner address (zero address = not drawn).
    /// @return status Raffle status as uint8.
    /// @return statusString Raffle status as string.
    /// @return claimed Whether the prize has been claimed.
    /// @return collection NFT collection address for the prize.
    /// @return prizeAmount Amount of NFTs awarded.
    /// @return prizeType Prize token type as uint8.
    /// @return prizeTypeString Prize token type as string.
    function getRaffleResult(
        string calldata raffleId
    )
        external
        view
        returns (
            uint256 winnerSlot,
            address winner,
            uint8 status,
            string memory statusString,
            bool claimed,
            address collection,
            uint256 prizeAmount,
            uint8 prizeType,
            string memory prizeTypeString
        )
    {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        return (
            r.winnerSlot,
            r.winner,
            uint8(r.status),
            _statusToString(r.status),
            r.claimed,
            r.collection,
            r.prizeAmount,
            uint8(r.prizeType),
            _prizeTypeToString(r.prizeType)
        );
    }

    /// @notice Get all raffleIds that the given user has ever joined.
    // this is for history -list raffle join
    function getUserRaffles(address user) external view returns (string[] memory) {
        string[] storage list = _userRafflesMulti[user];
        string[] memory out = new string[](list.length);
        for (uint256 i = 0; i < list.length; i++) {
            out[i] = list[i];
        }
        return out;
    }

    /// @notice Get all slot numbers owned by `user` in the given raffle.
    function getUserRaffleSlots(
        string calldata raffleId,
        address user
    ) external view returns (uint256[] memory) {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        uint256[] storage slots = _userSlotsMulti[id][user];
        uint256[] memory out = new uint256[](slots.length);
        for (uint256 i = 0; i < slots.length; i++) {
            out[i] = slots[i];
        }
        return out;
    }

    /// @notice Check whether the given `slotIds` are free and in-range.
    /// @return unavailable List of slot numbers that are out-of-range or taken.
    function checkSlotsAvailability(
        string calldata raffleId,
        uint256[] calldata slotIds
    ) external view returns (uint256[] memory unavailable) {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");

        uint256 len = slotIds.length;
        uint256[] memory tmp = new uint256[](len);
        uint256 count;

        for (uint256 i = 0; i < len; i++) {
            uint256 slot = slotIds[i];
            if (slot < 1 || slot > r.totalSlots || _slotOwnerMulti[id][slot] != address(0)) {
                tmp[count] = slot;
                count++;
            }
        }

        unavailable = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            unavailable[i] = tmp[i];
        }
    }
 
    /// @notice Get all taken slots in the given inclusive slot range for a raffle.
    /// @dev Use (startSlot = 1, endSlot = totalSlots) for a full scan, or smaller ranges for paging.
    function getTakenSlotsInRange(
        string calldata raffleId,
        uint256 startSlot,
        uint256 endSlot
    ) external view returns (uint256[] memory takenSlots) {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(startSlot >= 1 && endSlot >= startSlot && endSlot <= r.totalSlots, "InvalidRange");

        uint256 len = endSlot - startSlot + 1;
        uint256[] memory tmp = new uint256[](len);
        uint256 count;

        for (uint256 slot = startSlot; slot <= endSlot; slot++) {
            if (_slotOwnerMulti[id][slot] != address(0)) {
                tmp[count] = slot;
                count++;
            }
        }

        takenSlots = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            takenSlots[i] = tmp[i];
        }
    }

    /// @notice Get all available (free) slots in the given inclusive slot range for a raffle.
    /// @dev Use (startSlot = 1, endSlot = totalSlots) for a full scan, or smaller ranges for paging.
    function getAvailableSlotsInRange(
        string calldata raffleId,
        uint256 startSlot,
        uint256 endSlot
    ) external view returns (uint256[] memory availableSlots) {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(startSlot >= 1 && endSlot >= startSlot && endSlot <= r.totalSlots, "InvalidRange");

        uint256 len = endSlot - startSlot + 1;
        uint256[] memory tmp = new uint256[](len);
        uint256 count;

        for (uint256 slot = startSlot; slot <= endSlot; slot++) {
            if (_slotOwnerMulti[id][slot] == address(0)) {
                tmp[count] = slot;
                count++;
            }
        }

        availableSlots = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            availableSlots[i] = tmp[i];
        }
    }

    /// @notice Claim a refund for an expired raffle that did not sell out.
    /// todo add: if subscribed (then return full) ->> this using signature
    function claimRefund(string calldata raffleId) external {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");
        require(r.expiresAt != 0 && block.timestamp > r.expiresAt, "NotExpired");
        require(r.soldSlots < r.totalSlots, "RaffleFilled");
        require(
            r.status == MultiRaffleStatus.OPEN || r.status == MultiRaffleStatus.CANCELLED,
            "BadStatus"
        );

        uint256 paid = _userPaidMulti[id][msg.sender];
        require(paid > 0, "NothingToRefund");

        if (r.status == MultiRaffleStatus.OPEN) {
            r.status = MultiRaffleStatus.CANCELLED;
        }

        _userPaidMulti[id][msg.sender] = 0;

        uint256 refundAmount = (paid * (10000 - refundFeeBps)) / 10000;

        (bool ok, ) = msg.sender.call{value: refundAmount}("");
        require(ok, "RefundFailed");
    }

    /// @notice View helper giving detailed refund status for a user in a raffle.
    /// @return paid Total amount the user has paid into this raffle.
    /// @return refundableAmount Amount the user would receive if claiming a refund now.
    /// @return expired Whether the raffle is past its expiry time.
    /// @return canClaim Whether the user currently satisfies the on-chain conditions to claim a refund.
    /// @return status Raffle status as uint8.
    function getRefundStatus(
        string calldata raffleId,
        address user
    )
        external
        view
        returns (
            uint256 paid,
            uint256 refundableAmount,
            bool expired,
            bool canClaim,
            uint8 status
        )
    {
        bytes32 id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length != 0, "RaffleNotFound");

        status = uint8(r.status);
        expired = (r.expiresAt != 0 && block.timestamp > r.expiresAt);
        bool notFilled = r.soldSlots < r.totalSlots;

        paid = _userPaidMulti[id][user];
        if (paid > 0) {
            refundableAmount = (paid * (10000 - refundFeeBps)) / 10000;
        }

        canClaim = (
            expired &&
            notFilled &&
            (r.status == MultiRaffleStatus.OPEN || r.status == MultiRaffleStatus.CANCELLED) &&
            paid > 0
        );
    }

    /// @notice Owner can update the refund fee in basis points (out of 10_000).
    function setRefundFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 10_000, "FeeTooHigh");
        refundFeeBps = newFeeBps;
    }

    /// @notice Owner can update the backend signer used for EIP-712 permits.
    function setBackendSigner(address signer) external onlyOwner {
        require(signer != address(0), "InvalidSigner");
        backendSigner = signer;
        emit BackendSignerUpdated(signer);
    }

    // =============================================================
    // Internal helpers
    // =============================================================

    function _handleNativePayment(bytes32 id, address payer, uint256 amount) internal {
        require(msg.value == amount, "BadPayment");
        if (amount > 0) {
            _userPaidMulti[id][payer] += amount;
        }
    }

    function _createRaffle(
        string calldata raffleId,
        uint256 totalSlots,
        uint256 maxSlotsPerAddress,
        string calldata metadataUri,
        address collection,
        bool premintContract,
        bool premint,
        PrizeTokenType prizeType,
        uint256 prizeAmount,
        bool autoDraw,
        bool autoClaim,
        uint64 expiresAt
    ) internal returns (bytes32 id) {
        require(totalSlots > 0, "TotalSlotsZero");
        require(maxSlotsPerAddress > 0, "MaxSlotsZero");

        id = keccak256(bytes(raffleId));
        MultiRaffle storage r = _multiRaffles[id];
        require(bytes(r.raffleId).length == 0, "RaffleExists");

        r.raffleId = raffleId;
        r.totalSlots = totalSlots;
        r.maxSlotsPerAddress = maxSlotsPerAddress;
        r.metadataUri = metadataUri;
        r.collection = collection;
        r.premintContract = premintContract;
        r.premint = premint;
        r.autoDraw = autoDraw;
        r.autoClaim = autoClaim;
        r.prizeType = prizeType;
        r.prizeAmount = prizeAmount;
        r.createdAt = uint64(block.timestamp);
        r.expiresAt = expiresAt;
        r.status = MultiRaffleStatus.OPEN;
        r.soldSlots = 0;
        r.claimed = false;

        emit MultiRaffleHosted(id, raffleId, msg.sender);
    }

    function _consumePermit(bytes32 digest, bytes calldata signature) internal {
        require(backendSigner != address(0), "SignerNotSet");
        require(!usedPermits[digest], "PermitUsed");
        address signer = ECDSA.recover(digest, signature);
        require(signer == backendSigner, "InvalidSignature");
        usedPermits[digest] = true;
    }

    function _hashHostRaffle(
        string calldata raffleId,
        uint256 totalSlots,
        uint256 maxSlotsPerAddress,
        string calldata metadataUri,
        address collection,
        bool premintContract,
        bool premint,
        PrizeTokenType prizeType,
        uint256 prizeAmount,
        bool autoDraw,
        bool autoClaim,
        uint64 expiresAt,
        address organizer
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                HOST_RAFFLE_TYPEHASH,
                keccak256(bytes(raffleId)),
                totalSlots,
                maxSlotsPerAddress,
                keccak256(bytes(metadataUri)),
                collection,
                premintContract,
                premint,
                prizeType,
                prizeAmount,
                autoDraw,
                autoClaim,
                expiresAt,
                organizer
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _hashJoinRaffle(
        string calldata raffleId,
        uint256[] calldata slotIds,
        uint256 amount,
        address token,
        address payer
    ) internal view returns (bytes32) {
        bytes32 slotIdsHash = keccak256(abi.encodePacked(slotIds));
        bytes32 structHash = keccak256(
            abi.encode(
                JOIN_RAFFLE_TYPEHASH,
                keccak256(bytes(raffleId)),
                slotIdsHash,
                amount,
                token,
                payer
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _hashHostAndJoinRaffle(
        string calldata raffleId,
        uint256 totalSlots,
        uint256 maxSlotsPerAddress,
        string calldata metadataUri,
        address collection,
        bool premintContract,
        bool premint,
        PrizeTokenType prizeType,
        uint256 prizeAmount,
        bool autoDraw,
        bool autoClaim,
        uint64 expiresAt,
        uint256[] calldata slotIds,
        uint256 amount,
        address token,
        uint256 bonusFreeSlots,
        address payer
    ) internal view returns (bytes32) {
        bytes32 slotIdsHash = keccak256(abi.encodePacked(slotIds));
        bytes32 structHash = keccak256(
            abi.encode(
                HOST_AND_JOIN_RAFFLE_TYPEHASH,
                keccak256(bytes(raffleId)),
                totalSlots,
                maxSlotsPerAddress,
                keccak256(bytes(metadataUri)),
                collection,
                premintContract,
                premint,
                prizeType,
                prizeAmount,
                autoDraw,
                autoClaim,
                expiresAt,
                slotIdsHash,
                amount,
                token,
                bonusFreeSlots,
                payer
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _joinRaffle(
        bytes32 id,
        MultiRaffle storage r,
        uint256[] calldata slotIds,
        address payer,
        uint256 bonusFreeSlots,
        uint256 paidAmount
    ) internal {
        uint256 requested = slotIds.length;
        require(requested > 0, "NoSlots");

        uint256 remaining = r.totalSlots - r.soldSlots;
        require(requested <= remaining, "OverCapacity");

        uint256 current = _userSlotCountMulti[id][payer];
        require(current + requested <= r.maxSlotsPerAddress, "MaxSlotsPerAddress");

        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            require(slot >= 1 && slot <= r.totalSlots, "SlotOutOfRange");

            for (uint256 j = 0; j < i; j++) {
                require(slotIds[j] != slot, "DuplicateSlot");
            }

            require(_slotOwnerMulti[id][slot] == address(0), "SlotTaken");
        }

        if (current == 0) {
            _userRafflesMulti[payer].push(r.raffleId);
        }

        for (uint256 i = 0; i < requested; i++) {
            uint256 slot = slotIds[i];
            _slotOwnerMulti[id][slot] = payer;
            _userSlotsMulti[id][payer].push(slot);
        }

        _userSlotCountMulti[id][payer] = current + requested;
        r.soldSlots += requested;

        emit MultiRaffleJoined(id, payer, slotIds, paidAmount);

        if (r.soldSlots == r.totalSlots) {
            r.status = MultiRaffleStatus.FILLED;
            emit MultiRaffleFilled(id, r.totalSlots);

            // Auto-draw is now controlled by the explicit autoDraw flag.
            if (r.autoDraw) {
                _endRaffleInternal(id, r);
            }
        }
    }


    // will be called by draw or by join
    function _endRaffleInternal(bytes32 id, MultiRaffle storage r) internal {
        require(r.status == MultiRaffleStatus.FILLED, "BadStatus");

        uint256 winnerSlot = (block.timestamp % r.totalSlots) + 1;
        address winner = _slotOwnerMulti[id][winnerSlot];
        require(winner != address(0), "NoWinner");

        r.winnerSlot = winnerSlot;
        r.winner = winner;
        r.status = MultiRaffleStatus.DRAWN;

        emit MultiRaffleDrawn(id, winnerSlot, winner);

        if (r.autoClaim) {
            // todo: check if prize erc721, erc1155, erc404
            _mintPrize(id, r, winner);
            r.claimed = true;
        }
    }

    function _mintPrize(bytes32 id, MultiRaffle storage r, address to) internal {
        require(r.collection != address(0), "NoCollection");

        // Default values for legacy raffles that did not specify prize type/amount.
        if (r.prizeType == PrizeTokenType.NONE) {
            r.prizeType = PrizeTokenType.ERC721;
        }
        if (r.prizeAmount == 0) {
            r.prizeAmount = 1;
        }

        if (r.prizeType == PrizeTokenType.ERC721) {
            uint256 amountToMint = r.prizeAmount;
            for (uint256 i = 0; i < amountToMint; i++) {
                uint256 mintedId = ICollectionMint(r.collection).mintTo(
                    to,
                    r.metadataUri
                );
                emit MultiRafflePrizeMinted(id, to, mintedId, r.metadataUri);
            }
        } else if (r.prizeType == PrizeTokenType.ERC1155) {
            revert("ERC1155PrizeNotImplemented");
        } else if (r.prizeType == PrizeTokenType.ERC404) {
            revert("ERC404PrizeNotImplemented");
        } else {
            revert("UnknownPrizeType");
        }
    }
}
