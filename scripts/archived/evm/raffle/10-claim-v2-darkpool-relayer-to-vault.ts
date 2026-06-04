import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";
  const raffleAddress = process.env.RAFFLE_ADDRESS;
  const raffleId = process.env.RAFFLE_ID;
  const vaultAddress = process.env.VAULT_ADDRESS;

  if (!raffleAddress) throw new Error("RAFFLE_ADDRESS env var is required");
  if (!raffleId) throw new Error("RAFFLE_ID env var is required");
  if (!vaultAddress) throw new Error("VAULT_ADDRESS env var is required");

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

  const encOwnerHex = process.env.ENC_OWNER_HEX || "";
  const plaintextOwner = process.env.PLAINTEXT_OWNER || "";

  console.log("Relayer signer:", signer.address);
  console.log("Raffle:", raffleAddress);
  console.log("RaffleId:", raffleId);
  console.log("Vault:", vaultAddress);

  const raffle = new ethers.Contract(
    raffleAddress,
    [
      "function claimToVault(string raffleId,address vault,bytes encryptedOwner) external",
      "function unsafeClaimToVaultPlaintextOwner(string raffleId,address vault,address plaintextOwner) external",
    ],
    signer,
  );

  let tx;
  if (encOwnerHex) {
    tx = await raffle.claimToVault(raffleId, vaultAddress, ethers.getBytes(encOwnerHex));
  } else {
    if (!plaintextOwner) throw new Error("Provide ENC_OWNER_HEX (preferred) or PLAINTEXT_OWNER (dev)");
    tx = await raffle.unsafeClaimToVaultPlaintextOwner(raffleId, vaultAddress, plaintextOwner);
  }

  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

