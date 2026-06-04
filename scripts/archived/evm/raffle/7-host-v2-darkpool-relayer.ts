import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";
  const raffleAddress = process.env.RAFFLE_ADDRESS;

  if (!raffleAddress) throw new Error("RAFFLE_ADDRESS env var is required");

  let rpcUrl: string | undefined;
  if (target === "polygonAmoy") rpcUrl = process.env.POLYGON_AMOY_RPC_URL;
  else if (target === "arbitrumSepolia") rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  else if (target === "polkadotTestnet") rpcUrl = process.env.POLKADOT_TESTNET_RPC_URL;
  else rpcUrl = process.env.SEPOLIA_RPC_URL;

  const pk =
    process.env.PRIVATE_KEY_ETH ||
    process.env.SEPOLIA_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_ETH_2;

  if (!rpcUrl) throw new Error("RPC URL env var is required for target network");
  if (!pk) throw new Error("PRIVATE_KEY_ETH / PRIVATE_KEY_ETH_2 or SEPOLIA_PRIVATE_KEY is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);

  const raffleId = process.env.RAFFLE_ID || `dp-relayer-${Date.now()}`;
  const totalSlots = BigInt(process.env.RAFFLE_TOTAL_SLOTS || "100");
  const maxSlotsPerWallet = BigInt(process.env.RAFFLE_MAX_SLOTS_PER_WALLET || "10");
  const metadataUri =
    process.env.RAFFLE_METADATA_URI ||
    "https://example.com/dp-relayer-metadata.json";
  const collection = process.env.RAFFLE_COLLECTION || ethers.ZeroAddress;
  const prizeType = Number(process.env.RAFFLE_PRIZE_TYPE || "1"); // 1=ERC721
  const prizeAmount = BigInt(process.env.RAFFLE_PRIZE_AMOUNT || "1");
  const autoDraw = process.env.RAFFLE_AUTO_DRAW !== "false";
  const autoClaim = process.env.RAFFLE_AUTO_CLAIM === "true";
  const expiresInSeconds = Number(process.env.RAFFLE_EXPIRES_IN_SECONDS || "3600");
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Math.max(expiresInSeconds, 0));

  console.log("Signer (organizer):", signer.address);
  console.log("Hosting relayer darkpool raffle:", {
    raffleId,
    totalSlots: totalSlots.toString(),
    maxSlotsPerWallet: maxSlotsPerWallet.toString(),
    metadataUri,
    collection,
    prizeType,
    prizeAmount: prizeAmount.toString(),
    autoDraw,
    autoClaim,
    expiresAt: Number(expiresAt),
  });

  const raffle = new ethers.Contract(
    raffleAddress,
    [
      "function unsafeHostRaffle(string raffleId,uint256 totalSlots,uint256 maxSlotsPerWallet,string metadataUri,address collection,uint8 prizeType,uint256 prizeAmount,bool autoDraw,bool autoClaim,uint64 expiresAt) external returns (bytes32)",
    ],
    signer,
  );

  const tx = await raffle.unsafeHostRaffle(
    raffleId,
    totalSlots,
    maxSlotsPerWallet,
    metadataUri,
    collection,
    prizeType,
    prizeAmount,
    autoDraw,
    autoClaim,
    expiresAt,
  );
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

