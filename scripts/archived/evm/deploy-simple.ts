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

  // 1. Deploy ERC721MG
  console.log("\n1. Deploying ERC721MG...");
  const erc721mgArtifact = require("../artifacts/contracts/ERC721MG.sol/ERC721MG.json");
  const erc721mgFactory = new ethers.ContractFactory(
    erc721mgArtifact.abi,
    erc721mgArtifact.bytecode,
    wallet,
  );
  const erc721mg = await erc721mgFactory.deploy("Mogate Giftcode", "MG");
  await erc721mg.waitForDeployment();
  const erc721mgAddress = await erc721mg.getAddress();
  console.log("ERC721MG deployed to:", erc721mgAddress);

  // 2. Deploy AuthorityMintGateway
  console.log("\n2. Deploying AuthorityMintGateway...");
  const gatewayArtifact = require("../artifacts/contracts/gateways/AuthorityMintGateway.fhe.faucet.sol/AuthorityMintGateway.json");
  const gatewayFactory = new ethers.ContractFactory(
    gatewayArtifact.abi,
    gatewayArtifact.bytecode,
    wallet,
  );
  const gateway = await gatewayFactory.deploy();
  await gateway.waitForDeployment();
  const gatewayAddress = await gateway.getAddress();
  console.log("AuthorityMintGateway deployed to:", gatewayAddress);

  // 3. Deploy TestMGC
  console.log("\n3. Deploying TestMGC...");
  const testmgcArtifact = require("../artifacts/contracts/ERC721.sol/TestMGC.json");
  const testmgcFactory = new ethers.ContractFactory(
    testmgcArtifact.abi,
    testmgcArtifact.bytecode,
    wallet,
  );
  const testMGC = await testmgcFactory.deploy(wallet.address);
  await testMGC.waitForDeployment();
  const testMGCAddress = await testMGC.getAddress();
  console.log("TestMGC deployed to:", testMGCAddress);

  // 4. Deploy MyToken
  console.log("\n4. Deploying MyToken...");
  const mytokenArtifact = require("../artifacts/contracts/simplERC721.sol/MyToken.json");
  const mytokenFactory = new ethers.ContractFactory(
    mytokenArtifact.abi,
    mytokenArtifact.bytecode,
    wallet,
  );
  const myToken = await mytokenFactory.deploy(wallet.address);
  await myToken.waitForDeployment();
  const myTokenAddress = await myToken.getAddress();
  console.log("MyToken deployed to:", myTokenAddress);

  // Setup
  console.log("\n=== Setup ===");
  await erc721mg.setMinter(gatewayAddress, true);
  console.log("Gateway set as minter for ERC721MG");

  await gateway.setCollectionAllowed(erc721mgAddress, true);
  console.log("ERC721MG allowed in gateway");

  console.log("\n=== Deployment Summary ===");
  console.log("ERC721MG:", erc721mgAddress);
  console.log("AuthorityMintGateway:", gatewayAddress);
  console.log("TestMGC:", testMGCAddress);
  console.log("MyToken:", myTokenAddress);

  console.log("\n=== Verification Commands ===");
  console.log(
    `npx hardhat verify --network sepolia ${erc721mgAddress} "Mogate Giftcode" "MG"`,
  );
  console.log(`npx hardhat verify --network sepolia ${gatewayAddress}`);
  console.log(
    `npx hardhat verify --network sepolia ${testMGCAddress} ${wallet.address}`,
  );
  console.log(
    `npx hardhat verify --network sepolia ${myTokenAddress} ${wallet.address}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
