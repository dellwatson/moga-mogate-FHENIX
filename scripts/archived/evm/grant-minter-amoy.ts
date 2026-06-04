import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const COLLECTION_ADDRESS = "0xFe9DF23d3EFAB6cC71D3395aFFB3aa505d1935eB";
const RAFFLE_ADDRESS = "0xF62ED4a31D712501d3E61277A03bba7Ac34EE4db";

// Collection ABI - only need setMinter function and minters mapping
const COLLECTION_ABI = [
  "function setMinter(address minter, bool allowed) external",
  "function minters(address account) external view returns (bool)",
];

async function main() {
  // Setup provider and wallet
  const rpcUrl = process.env.POLYGON_AMOY_RPC_URL || "";
  const privateKey = process.env.PRIVATE_KEY_ETH || "";

  if (!rpcUrl || !privateKey) {
    throw new Error("Missing POLYGON_AMOY_RPC_URL or PRIVATE_KEY_ETH in .env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Granting minter role on Polygon Amoy");
  console.log("Wallet address:", wallet.address);
  console.log("Collection:", COLLECTION_ADDRESS);
  console.log("Raffle (to be granted minter):", RAFFLE_ADDRESS);

  const balance = await provider.getBalance(wallet.address);
  console.log("Wallet balance:", ethers.formatEther(balance), "MATIC");

  // Create collection contract instance
  const collection = new ethers.Contract(
    COLLECTION_ADDRESS,
    COLLECTION_ABI,
    wallet,
  );

  // Check if already a minter
  console.log("\nChecking current minter status...");
  const isCurrentlyMinter = await collection.minters(RAFFLE_ADDRESS);
  console.log("Is Raffle already a minter?", isCurrentlyMinter);

  if (isCurrentlyMinter) {
    console.log("\n✅ Raffle is already a minter on this collection!");
    return;
  }

  // Grant minter role
  console.log("\nGranting minter role...");
  const tx = await collection.setMinter(RAFFLE_ADDRESS, true);
  console.log("Transaction hash:", tx.hash);

  console.log("Waiting for confirmation...");
  const receipt = await tx.wait();

  console.log("\n✅ Minter role granted successfully!");
  console.log("Block number:", receipt?.blockNumber);
  console.log("Gas used:", receipt?.gasUsed.toString());
  console.log("Transaction:", `https://amoy.polygonscan.com/tx/${tx.hash}`);

  // Verify
  console.log("\nVerifying minter status...");
  const isMinterNow = await collection.minters(RAFFLE_ADDRESS);
  console.log("Is Raffle a minter now?", isMinterNow);

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed.toString(),
  };
}

main()
  .then((result) => {
    if (result) {
      console.log("\n📝 Transaction details:");
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Failed to grant minter role:");
    console.error(error);
    process.exit(1);
  });
