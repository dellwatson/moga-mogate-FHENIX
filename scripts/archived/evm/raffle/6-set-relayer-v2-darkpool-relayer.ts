import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";
  const raffleAddress = process.env.RAFFLE_ADDRESS;
  const relayerAddress = process.env.RELAYER_ADDRESS;
  const allowed = (process.env.RELAYER_ALLOWED || "true").toLowerCase() !== "false";

  if (!raffleAddress) throw new Error("RAFFLE_ADDRESS env var is required");
  if (!relayerAddress) throw new Error("RELAYER_ADDRESS env var is required");

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

  console.log("Signer (owner):", signer.address);
  console.log("Raffle:", raffleAddress);
  console.log("Relayer:", relayerAddress, "allowed:", allowed);

  const raffle = new ethers.Contract(
    raffleAddress,
    ["function setRelayer(address relayer, bool allowed) external"],
    signer,
  );

  const tx = await raffle.setRelayer(relayerAddress, allowed);
  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

