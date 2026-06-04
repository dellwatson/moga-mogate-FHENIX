import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const network = process.env.TARGET_NETWORK || "polygonAmoy";
  const collectionAddress = process.env.COLLECTION_ADDRESS;
  const raffleAddress = process.env.RAFFLE_ADDRESS;

  if (!collectionAddress)
    throw new Error("COLLECTION_ADDRESS env var is required");
  if (!raffleAddress) throw new Error("RAFFLE_ADDRESS env var is required");

  const rpcUrls: Record<string, string> = {
    polygonAmoy:
      process.env.POLYGON_AMOY_RPC_URL ||
      "https://polygon-amoy-bor-rpc.publicnode.com",
    arbitrumSepolia:
      process.env.ARBITRUM_SEPOLIA_RPC_URL ||
      "https://sepolia-rollup.arbitrum.io/rpc",
    sepolia: process.env.SEPOLIA_RPC_URL || "",
  };

  const rpcUrl = rpcUrls[network];
  if (!rpcUrl) throw new Error(`Unsupported network: ${network}`);

  const privateKey =
    process.env.PRIVATE_KEY_ETH || process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY_ETH env var is required");

  console.log(`Setting Raffle as minter on ${network}...`);
  console.log(`Collection: ${collectionAddress}`);
  console.log(`Raffle: ${raffleAddress}`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`Using signer: ${signer.address}`);

  const collection = new ethers.Contract(
    collectionAddress,
    ["function setMinter(address minter, bool allowed) external"],
    signer,
  );

  console.log("Calling setMinter(raffle, true)...");
  const tx = await collection.setMinter(raffleAddress, true);
  console.log(`Transaction hash: ${tx.hash}`);

  console.log("Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log(`✅ Confirmed in block: ${receipt.blockNumber}`);

  const explorerUrls: Record<string, string> = {
    polygonAmoy: "https://amoy.polygonscan.com",
    arbitrumSepolia: "https://sepolia.arbiscan.io",
    sepolia: "https://sepolia.etherscan.io",
  };

  const explorerUrl = explorerUrls[network];
  console.log(`\nView transaction: ${explorerUrl}/tx/${tx.hash}`);
  console.log(
    `\n✅ Raffle contract (${raffleAddress}) is now a minter on Collection (${collectionAddress})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
