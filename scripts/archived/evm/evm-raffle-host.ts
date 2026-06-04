import { ethers } from "ethers";
import * as dotenv from "dotenv";
import {
  createRaffleClient,
  PrizeTokenType,
  unsafeHostRaffleWithReport,
} from "../../ts-sdk/src/evm/index.ts";

dotenv.config();

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";

  const rpcUrls: Record<string, string> = {
    polygonAmoy:
      process.env.POLYGON_AMOY_RPC_URL ||
      "https://polygon-amoy-bor-rpc.publicnode.com",
    arbitrumSepolia:
      process.env.ARBITRUM_SEPOLIA_RPC_URL ||
      "https://sepolia-rollup.arbitrum.io/rpc",
    sepolia: process.env.SEPOLIA_RPC_URL || "",
  };

  const raffleAddresses: Record<string, string> = {
    polygonAmoy:
      process.env.RAFFLE_ADDRESS_POLYGON_AMOY ||
      "0x981a93Ba85CA910BeB8B093CC3677e195d2A1984",
    arbitrumSepolia:
      process.env.RAFFLE_ADDRESS_ARBITRUM_SEPOLIA ||
      "0x9D2067BeB1c165FDE0F89E40Bd97f3276C153385",
    sepolia:
      process.env.RAFFLE_ADDRESS_SEPOLIA ||
      "0xAb9aA6e05a9327276aD4163002bfA76bE3414B72",
  };

  const collectionAddresses: Record<string, string> = {
    polygonAmoy:
      process.env.COLLECTION_ADDRESS_POLYGON_AMOY || ethers.ZeroAddress,
    arbitrumSepolia:
      process.env.COLLECTION_ADDRESS_ARBITRUM_SEPOLIA || ethers.ZeroAddress,
    sepolia:
      process.env.COLLECTION_ADDRESS_SEPOLIA ||
      "0x453DFfb360d8fdAFd952e368c6fD4e23517A4004",
  };

  const rpcUrl = rpcUrls[target];
  const raffleAddress = raffleAddresses[target];
  const collection = collectionAddresses[target];

  const pk =
    process.env.PRIVATE_KEY_ETH ||
    process.env.SEPOLIA_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_ETH_2;

  if (!rpcUrl)
    throw new Error("RPC URL env var is required for target network");
  if (!raffleAddress)
    throw new Error("Raffle address env var for target network is required");
  if (!pk)
    throw new Error(
      "PRIVATE_KEY_ETH / PRIVATE_KEY_ETH_2 or SEPOLIA_PRIVATE_KEY env var is required",
    );

  const client = createRaffleClient({
    rpcUrl,
    privateKey: pk,
    raffleAddress,
  });

  const raffleId = process.env.RAFFLE_ID || `test-${Date.now()}`;
  const totalSlots = BigInt(process.env.RAFFLE_TOTAL_SLOTS || "5");
  const maxSlotsPerAddress = BigInt(
    process.env.RAFFLE_MAX_SLOTS_PER_ADDRESS || "5",
  );
  const metadataUri =
    process.env.RAFFLE_METADATA_URI ||
    "https://example.com/raffle-metadata.json";

  const premintContract = process.env.RAFFLE_PREMINT_CONTRACT === "true";
  const premint = process.env.RAFFLE_PREMINT === "true";

  const prizeTypeEnv = process.env.RAFFLE_PRIZE_TYPE;
  const prizeType: PrizeTokenType =
    prizeTypeEnv !== undefined
      ? (Number(prizeTypeEnv) as PrizeTokenType)
      : PrizeTokenType.ERC721;

  const prizeAmount = BigInt(process.env.RAFFLE_PRIZE_AMOUNT || "1");

  const autoClaimEnv = process.env.RAFFLE_AUTO_CLAIM;
  const autoClaim =
    autoClaimEnv === "true"
      ? true
      : autoClaimEnv === "false"
      ? false
      : collection !== ethers.ZeroAddress;

  const autoDrawEnv = process.env.RAFFLE_AUTO_DRAW;
  const autoDraw =
    autoDrawEnv === "true"
      ? true
      : autoDrawEnv === "false"
      ? false
      : !autoClaim;

  const expiresInSeconds = Number(
    process.env.RAFFLE_EXPIRES_IN_SECONDS || "3600",
  );
  const expiresAt = BigInt(
    Math.floor(Date.now() / 1000) + Math.max(expiresInSeconds, 0),
  );

  console.log("Hosting raffle on", target);
  console.log(
    JSON.stringify(
      {
        raffleAddress,
        raffleId,
        totalSlots: totalSlots.toString(),
        maxSlotsPerAddress: maxSlotsPerAddress.toString(),
        metadataUri,
        collection,
        premintContract,
        premint,
        prizeType,
        prizeAmount: prizeAmount.toString(),
        autoDraw,
        autoClaim,
        expiresAt: Number(expiresAt),
      },
      null,
      2,
    ),
  );

  const report = await unsafeHostRaffleWithReport(client, {
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
  });

  console.log("\n=== HOST REPORT ===");
  console.log(
    JSON.stringify(
      report,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
