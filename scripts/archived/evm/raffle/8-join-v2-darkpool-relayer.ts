import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

function parseSlotIds(raw: string): bigint[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => BigInt(s));
}

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";
  const raffleAddress = process.env.RAFFLE_ADDRESS;
  const raffleId = process.env.RAFFLE_ID;
  const slotIdsRaw = process.env.SLOT_IDS;

  if (!raffleAddress) throw new Error("RAFFLE_ADDRESS env var is required");
  if (!raffleId) throw new Error("RAFFLE_ID env var is required");
  if (!slotIdsRaw) throw new Error("SLOT_IDS env var is required (e.g. 1,2,3)");

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

  const slotIds = parseSlotIds(slotIdsRaw);
  const amountEth = process.env.JOIN_AMOUNT_ETH || "0";
  const amountWei = ethers.parseEther(amountEth);

  const encOwnerHex = process.env.ENC_OWNER_HEX || "";
  const plaintextOwner = process.env.PLAINTEXT_OWNER || "";

  console.log("Relayer signer:", signer.address);
  console.log("Raffle:", raffleAddress);
  console.log("RaffleId:", raffleId);
  console.log("SlotIds:", slotIds.map(String).join(","));
  console.log("Amount ETH:", amountEth);
  console.log("Using ENC_OWNER_HEX:", !!encOwnerHex);

  const raffle = new ethers.Contract(
    raffleAddress,
    [
      "function unsafeJoinRaffleRelayed(string raffleId,uint256[] slotIds,uint256 amount,address token,bytes encryptedOwner) external payable",
      "function unsafeJoinRaffleRelayedPlaintextOwner(string raffleId,uint256[] slotIds,uint256 amount,address token,address plaintextOwner) external payable",
    ],
    signer,
  );

  let tx;
  if (encOwnerHex) {
    tx = await raffle.unsafeJoinRaffleRelayed(
      raffleId,
      slotIds,
      amountWei,
      ethers.ZeroAddress,
      ethers.getBytes(encOwnerHex),
      { value: amountWei },
    );
  } else {
    if (!plaintextOwner) {
      throw new Error("Provide ENC_OWNER_HEX (preferred) or PLAINTEXT_OWNER (dev)");
    }
    tx = await raffle.unsafeJoinRaffleRelayedPlaintextOwner(
      raffleId,
      slotIds,
      amountWei,
      ethers.ZeroAddress,
      plaintextOwner,
      { value: amountWei },
    );
  }

  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

