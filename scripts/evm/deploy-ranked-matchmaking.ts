const { ethers } = require("ethers");

async function main() {
  // Connect to Sepolia
  const provider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL ||
      "https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
  );
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_ETH, provider);

  console.log("Deploying with account:", wallet.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await provider.getBalance(wallet.address)),
    "ETH",
  );

  // Deploy RankedMatchmaking
  console.log("\nDeploying RankedMatchmaking...");
  const rankedMatchmakingArtifact = require("../../artifacts/contracts/RankedMatchmaking/RankedMatchmaking.json");
  const rankedMatchmakingFactory = new ethers.ContractFactory(
    rankedMatchmakingArtifact.abi,
    rankedMatchmakingArtifact.bytecode,
    wallet,
  );

  // Deploy with constructor parameters (if any) - RankedMatchmaking doesn't have constructor params
  const rankedMatchmaking = await rankedMatchmakingFactory.deploy();
  await rankedMatchmaking.waitForDeployment();
  const rankedMatchmakingAddress = await rankedMatchmaking.getAddress();
  console.log("RankedMatchmaking deployed to:", rankedMatchmakingAddress);

  // Initialize config with feeBps and authority
  console.log("\nInitializing config...");
  const feeBps = 500; // 5% fee
  const authority = wallet.address;

  const tx = await rankedMatchmaking.initConfig(feeBps, authority);
  await tx.wait();
  console.log(
    "Config initialized with feeBps:",
    feeBps,
    "and authority:",
    authority,
  );

  console.log("\n=== Deployment Summary ===");
  console.log("RankedMatchmaking:", rankedMatchmakingAddress);

  console.log("\n=== Verification Command ===");
  console.log(
    `npx hardhat verify --network sepolia ${rankedMatchmakingAddress}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
