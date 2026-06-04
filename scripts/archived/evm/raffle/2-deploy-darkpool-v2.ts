import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";

  let rpcUrl: string | undefined;
  if (target === "polygonAmoy") {
    rpcUrl = process.env.POLYGON_AMOY_RPC_URL;
  } else if (target === "arbitrumSepolia") {
    rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  } else if (target === "polkadotTestnet") {
    rpcUrl = process.env.POLKADOT_TESTNET_RPC_URL;
  } else {
    rpcUrl = process.env.SEPOLIA_RPC_URL;
  }

  const pk = process.env.PRIVATE_KEY_ETH || process.env.PRIVATE_KEY_ETH_2;
  if (!rpcUrl) throw Error("RPC URL env var is required for target network");
  if (!pk)
    throw Error("PRIVATE_KEY_ETH or PRIVATE_KEY_ETH_2 env var is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(pk, provider);

  console.log(
    "Deploying RaffleDarkpoolV2Relayer with:",
    await deployer.getAddress(),
  );

  // Use zero address for initial observer (same as vault)
  const initialObserver = "0x0000000000000000000000000000000000000000";

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.join(__dirname, "..", "..", "..");
  const artifactPath = path.join(
    repoRoot,
    "artifacts",
    "contracts",
    "Raffle.darkpool.v2.relayer.sol",
    "RaffleDarkpoolV2Relayer.json",
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    deployer,
  );
  const darkpool = await factory.deploy(initialObserver);
  const receipt = await darkpool.deploymentTransaction()?.wait();

  const address = await darkpool.getAddress();

  console.log("RaffleDarkpoolV2Relayer deployed to:", address);
  if (receipt)
    console.log("Deploy tx:", receipt.hash, "block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
