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

  const raffleId = process.env.RAFFLE_ID;
  if (!raffleId) throw new Error("RAFFLE_ID env var is required");

  const slotIdsRaw = process.env.RAFFLE_SLOT_IDS || "1";
  const slotIds = slotIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => BigInt(s));

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

  const raffleLoad = await raffle.getRaffleLoad(raffleId);
  const slotPriceWei = BigInt(raffleLoad[2].toString());
  const value = slotPriceWei * BigInt(slotIds.length);

  console.log("Joining raffle-v2 darkpool on", target);
  console.log(
    JSON.stringify(
      {
        raffleAddress,
        raffleId,
        slotIds: slotIds.map((s) => s.toString()),
        slotPriceWei: slotPriceWei.toString(),
        totalValueWei: value.toString(),
      },
      null,
      2,
    ),
  );

  const tx = await raffle.joinRaffle(raffleId, slotIds, { value });
  const receipt = await tx.wait();
  console.log("Join tx hash:", receipt?.hash ?? tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
