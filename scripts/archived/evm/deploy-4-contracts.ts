import { ethers } from "hardhat";

async function main() {
  console.log("Deploying 4 contracts to Sepolia...");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1. Deploy ERC721MG
  console.log("\n1. Deploying ERC721MG...");
  const ERC721MG = await ethers.getContractFactory("ERC721MG");
  const erc721mg = await ERC721MG.deploy("Mogate Giftcode", "MG");
  await erc721mg.waitForDeployment();
  const erc721mgAddress = await erc721mg.getAddress();
  console.log("ERC721MG:", erc721mgAddress);

  // 2. Deploy AuthorityMintGateway
  console.log("\n2. Deploying AuthorityMintGateway...");
  const AuthorityMintGateway = await ethers.getContractFactory(
    "AuthorityMintGateway",
  );
  const gateway = await AuthorityMintGateway.deploy();
  await gateway.waitForDeployment();
  const gatewayAddress = await gateway.getAddress();
  console.log("AuthorityMintGateway:", gatewayAddress);

  // 3. Deploy TestMGC
  console.log("\n3. Deploying TestMGC...");
  const TestMGC = await ethers.getContractFactory("TestMGC");
  const testMGC = await TestMGC.deploy(deployer.address);
  await testMGC.waitForDeployment();
  const testMGCAddress = await testMGC.getAddress();
  console.log("TestMGC:", testMGCAddress);

  // 4. Deploy MyToken
  console.log("\n4. Deploying MyToken...");
  const MyToken = await ethers.getContractFactory("MyToken");
  const myToken = await MyToken.deploy(deployer.address);
  await myToken.waitForDeployment();
  const myTokenAddress = await myToken.getAddress();
  console.log("MyToken:", myTokenAddress);

  // Setup
  console.log("\n=== Setup ===");
  await erc721mg.setMinter(gatewayAddress, true);
  await gateway.setCollectionAllowed(erc721mgAddress, true);
  console.log("Gateway configured as minter for ERC721MG");

  console.log("\n=== Verification Commands ===");
  console.log(
    `npx hardhat verify --network sepolia ${erc721mgAddress} "Mogate Giftcode" "MG"`,
  );
  console.log(`npx hardhat verify --network sepolia ${gatewayAddress}`);
  console.log(
    `npx hardhat verify --network sepolia ${testMGCAddress} ${deployer.address}`,
  );
  console.log(
    `npx hardhat verify --network sepolia ${myTokenAddress} ${deployer.address}`,
  );

  return {
    ERC721MG: erc721mgAddress,
    AuthorityMintGateway: gatewayAddress,
    TestMGC: testMGCAddress,
    MyToken: myTokenAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
