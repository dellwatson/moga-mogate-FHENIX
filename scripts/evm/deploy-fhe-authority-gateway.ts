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
    rpcUrl = process.env.SEPOLIA_RPC_URL || "https://sepolia.drpc.org";
  }

  const pk = process.env.PRIVATE_KEY_ETH || process.env.PRIVATE_KEY_ETH_2;
  if (!rpcUrl) throw Error("RPC URL env var is required for target network");
  if (!pk)
    throw Error("PRIVATE_KEY_ETH or PRIVATE_KEY_ETH_2 env var is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(pk, provider);
  console.log(
    "Deploying FHE AuthorityMintGateway with:",
    await deployer.getAddress(),
  );

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.join(__dirname, "..", "..");
  const artifactPath = path.join(
    repoRoot,
    "artifacts",
    "contracts",
    "gateways",
    "AuthorityMintGateway.fhe.faucet.sol",
    "AuthorityMintGateway.json",
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found at ${artifactPath}. Did you compile the FHE gateway contract?`,
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    deployer,
  );
  const gateway = await factory.deploy();
  const receipt = await gateway.deploymentTransaction()?.wait();

  const address = await gateway.getAddress();

  console.log("FHE AuthorityMintGateway deployed to:", address);
  if (receipt) {
    console.log("Deploy tx:", receipt.hash, "block:", receipt.blockNumber);
  }

  console.log("\n🔧 NEXT STEPS:");
  console.log("1. Update config.js with new gateway address:", address);
  console.log("2. Configure gateway: bun run 10-config-authority-gateway.ts");
  console.log("3. Verify on Etherscan");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
