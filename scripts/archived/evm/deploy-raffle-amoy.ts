import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

async function main() {
  // Setup provider and wallet
  const rpcUrl = process.env.POLYGON_AMOY_RPC_URL || "";
  const privateKey = process.env.PRIVATE_KEY_ETH || "";

  if (!rpcUrl || !privateKey) {
    throw new Error("Missing POLYGON_AMOY_RPC_URL or PRIVATE_KEY_ETH in .env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Deploying Raffle to Polygon Amoy");
  console.log("Deployer address:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "MATIC");

  // Read compiled contract
  const artifactPath = path.join(
    process.cwd(),
    "artifacts/contracts/Raffle.sol/Raffle.json",
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      "Contract artifact not found. Run 'bun run evm:compile' first.",
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi;
  const bytecode = artifact.bytecode;

  // Deploy contract
  console.log("\nDeploying contract...");
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy();

  console.log("Waiting for deployment...");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();

  console.log("\n✅ Raffle deployed successfully!");
  console.log("Contract address:", address);
  console.log("Deploy tx hash:", deployTx?.hash);
  console.log("Block number:", deployTx?.blockNumber);
  console.log("\nExplorer:", `https://amoy.polygonscan.com/address/${address}`);

  return {
    address,
    txHash: deployTx?.hash,
    blockNumber: deployTx?.blockNumber,
  };
}

main()
  .then((result) => {
    console.log("\n📝 Save this information for verification:");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
