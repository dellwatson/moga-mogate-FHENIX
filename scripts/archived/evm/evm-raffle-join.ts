import { ethers } from "ethers";
import * as dotenv from "dotenv";
import {
  createRaffleClient,
  unsafeJoinRaffleWithReport,
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

  const rpcUrl = rpcUrls[target];
  const raffleAddress = raffleAddresses[target];

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

  const raffleId = process.env.RAFFLE_ID;
  if (!raffleId) throw new Error("RAFFLE_ID env var is required");

  const slotIdsRaw = process.env.RAFFLE_SLOT_IDS || "1";
  const slotIds = slotIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => BigInt(s));

  const amountEth = process.env.RAFFLE_JOIN_AMOUNT_ETH || "0.01";
  const amount = ethers.parseEther(amountEth);

  console.log("Joining raffle on", target);
  console.log(
    JSON.stringify(
      {
        raffleAddress,
        raffleId,
        slotIds: slotIds.map((s) => s.toString()),
        amountEth,
      },
      null,
      2,
    ),
  );

  const report = await unsafeJoinRaffleWithReport(
    client,
    {
      raffleId,
      slotIds,
      amount,
      token: ethers.ZeroAddress,
    },
    amount,
  );

  console.log("\n=== JOIN REPORT ===");
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
