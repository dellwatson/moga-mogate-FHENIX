import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";

  const rpcUrls: Record<string, string> = {
    polygonAmoy: process.env.POLYGON_AMOY_RPC_URL || "",
    arbitrumSepolia: process.env.ARBITRUM_SEPOLIA_RPC_URL || "",
    polkadotTestnet: process.env.POLKADOT_TESTNET_RPC_URL || "",
    sepolia: process.env.SEPOLIA_RPC_URL || "",
  };

  const raffleAddresses: Record<string, string> = {
    polygonAmoy: process.env.RAFFLE_V2_DARKPOOL_ADDRESS_POLYGON_AMOY || "",
    arbitrumSepolia:
      process.env.RAFFLE_V2_DARKPOOL_ADDRESS_ARBITRUM_SEPOLIA || "",
    polkadotTestnet:
      process.env.RAFFLE_V2_DARKPOOL_ADDRESS_POLKADOT_TESTNET || "",
    sepolia: process.env.RAFFLE_V2_DARKPOOL_ADDRESS_SEPOLIA || "",
  };

  const rpcUrl = rpcUrls[target];
  const raffleAddress = raffleAddresses[target];

  const pk =
    process.env.PRIVATE_KEY_ETH ||
    process.env.SEPOLIA_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_ETH_2;

  if (!rpcUrl) throw new Error("RPC URL env var is required for target network");
  if (!raffleAddress) {
    throw new Error("RAFFLE_V2_DARKPOOL_ADDRESS env var for target network is required");
  }
  if (!pk) {
    throw new Error(
      "PRIVATE_KEY_ETH / PRIVATE_KEY_ETH_2 or SEPOLIA_PRIVATE_KEY env var is required",
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.join(__dirname, "..", "..");
  const artifactPath = path.join(
    repoRoot,
    "artifacts",
    "contracts",
    "Raffle.darkpool.v2.sol",
    "RaffleDarkpoolV2.json",
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const raffle = new ethers.Contract(raffleAddress, artifact.abi, signer);

  const raffleId = process.env.RAFFLE_ID || `darkpool-${Date.now()}`;
  const totalSlots = BigInt(process.env.RAFFLE_TOTAL_SLOTS || "100");
  const maxSlotsPerAddress = BigInt(
    process.env.RAFFLE_MAX_SLOTS_PER_ADDRESS || "10",
  );
  const slotPriceEth = process.env.RAFFLE_SLOT_PRICE_ETH || "0.001";
  const slotPriceWei = ethers.parseEther(slotPriceEth);
  const metadataUri =
    process.env.RAFFLE_METADATA_URI ||
    "https://example.com/raffle-v2-darkpool-metadata.json";
  const collection = process.env.RAFFLE_COLLECTION || ethers.ZeroAddress;

  const prizeType = Number(process.env.RAFFLE_PRIZE_TYPE || "1");
  const prizeAmount = BigInt(process.env.RAFFLE_PRIZE_AMOUNT || "1");

  const autoDraw = process.env.RAFFLE_AUTO_DRAW !== "false";
  const autoClaim = process.env.RAFFLE_AUTO_CLAIM === "true";

  const expiresInSeconds = Number(
    process.env.RAFFLE_EXPIRES_IN_SECONDS || "3600",
  );
  const expiresAt = BigInt(
    Math.floor(Date.now() / 1000) + Math.max(expiresInSeconds, 0),
  );

  console.log("Hosting raffle-v2 darkpool on", target);
  console.log(
    JSON.stringify(
      {
        raffleAddress,
        raffleId,
        totalSlots: totalSlots.toString(),
        maxSlotsPerAddress: maxSlotsPerAddress.toString(),
        slotPriceEth,
        metadataUri,
        collection,
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

  const tx = await raffle.hostRaffle(
    raffleId,
    totalSlots,
    maxSlotsPerAddress,
    slotPriceWei,
    metadataUri,
    collection,
    prizeType,
    prizeAmount,
    autoDraw,
    autoClaim,
    expiresAt,
  );
  const receipt = await tx.wait();
  console.log("Host tx hash:", receipt?.hash ?? tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
