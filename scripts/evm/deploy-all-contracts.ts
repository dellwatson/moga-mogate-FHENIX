import { ethers } from "hardhat";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Starting deployment of 4 contracts to Sepolia...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log(
    "Account balance:",
    (await deployer.provider.getBalance(deployer.address)).toString(),
  );

  // 1. Deploy ERC721MG (main FHE giftcode contract)
  console.log("\n1. Deploying ERC721MG...");
  const ERC721MG = await ethers.getContractFactory("ERC721MG");
  const erc721mg = await ERC721MG.deploy("Mogate Giftcode", "MG");
  await erc721mg.waitForDeployment();
  const erc721mgAddress = await erc721mg.getAddress();
  console.log("ERC721MG deployed to:", erc721mgAddress);

  // 2. Deploy AuthorityMintGateway
  console.log("\n2. Deploying AuthorityMintGateway...");
  const AuthorityMintGateway = await ethers.getContractFactory(
    "AuthorityMintGateway",
  );
  const gateway = await AuthorityMintGateway.deploy();
  await gateway.waitForDeployment();
  const gatewayAddress = await gateway.getAddress();
  console.log("AuthorityMintGateway deployed to:", gatewayAddress);

  // 3. Deploy TestMGC (test contract with extensions)
  console.log("\n3. Deploying TestMGC...");
  const TestMGC = await ethers.getContractFactory("TestMGC");
  const testMGC = await TestMGC.deploy(deployer.address);
  await testMGC.waitForDeployment();
  const testMGCAddress = await testMGC.getAddress();
  console.log("TestMGC deployed to:", testMGCAddress);

  // 4. Deploy MyToken (simple ERC721)
  console.log("\n4. Deploying MyToken...");
  const MyToken = await ethers.getContractFactory("MyToken");
  const myToken = await MyToken.deploy(deployer.address);
  await myToken.waitForDeployment();
  const myTokenAddress = await myToken.getAddress();
  console.log("MyToken deployed to:", myTokenAddress);

  // Setup configurations
  console.log("\n=== Setting up configurations ===");

  // Set gateway as minter on ERC721MG
  console.log("Setting gateway as minter on ERC721MG...");
  await erc721mg.setMinter(gatewayAddress, true);

  // Allow ERC721MG in gateway
  console.log("Allowing ERC721MG in gateway...");
  await gateway.setCollectionAllowed(erc721mgAddress, true);

  // Set pricing for unsafePurchase (0.01 ETH)
  console.log("Setting price for unsafePurchase (0.01 ETH)...");
  await gateway.setPrice(ethers.ZeroAddress, ethers.parseEther("0.01"));

  console.log("\n=== Deployment Summary ===");
  console.log("ERC721MG (FHE Giftcode):", erc721mgAddress);
  console.log("AuthorityMintGateway:", gatewayAddress);
  console.log("TestMGC (Test Contract):", testMGCAddress);
  console.log("MyToken (Simple ERC721):", myTokenAddress);

  console.log("\n=== Verification Commands ===");
  console.log(
    "npx hardhat verify --network sepolia",
    erc721mgAddress,
    '"Mogate Giftcode"',
    '"MG"',
  );
  console.log("npx hardhat verify --network sepolia", gatewayAddress);
  console.log(
    "npx hardhat verify --network sepolia",
    testMGCAddress,
    deployer.address,
  );
  console.log(
    "npx hardhat verify --network sepolia",
    myTokenAddress,
    deployer.address,
  );

  return {
    erc721mg: erc721mgAddress,
    gateway: gatewayAddress,
    testMGC: testMGCAddress,
    myToken: myTokenAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
