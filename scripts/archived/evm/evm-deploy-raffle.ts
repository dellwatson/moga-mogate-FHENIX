import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying Raffle with account:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");

  const Raffle = await hre.ethers.getContractFactory("Raffle");
  const raffle = await Raffle.deploy();

  await raffle.waitForDeployment();
  const address = await raffle.getAddress();

  console.log("Raffle deployed to:", address);
  console.log("Deploy transaction hash:", raffle.deploymentTransaction()?.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
