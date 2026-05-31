const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  console.log("🔧 Setting up minter for new contracts...");

  // Connect to Sepolia with Alchemy RPC
  const provider = new ethers.JsonRpcProvider(
    "https://eth-sepolia.g.alchemy.com/v2/demo",
  );
  const privateKey = process.env.PRIVATE_KEY_ETH || process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.error("❌ No private key found! Set PRIVATE_KEY_ETH in .env file");
    process.exit(1);
  }

  const deployer = new ethers.Wallet(privateKey, provider);
  console.log("👤 Setting minter with:", await deployer.getAddress());

  // NEW contract addresses
  const erc721mgAddress = "0x4cf031C2ecf8ee6b08bF7ab16a49636A0FADBF9D";
  const gatewayAddress = "0xA91D70aE85af28Efc23D5d90348a72A08C56056A";

  const repoRoot = path.join(__dirname, "..", "..");

  // Load ERC721MG ABI
  const erc721mgArtifactPath = path.join(
    repoRoot,
    "artifacts",
    "contracts",
    "ERC721MG.sol",
    "ERC721MG.json",
  );
  const erc721mgArtifact = JSON.parse(
    fs.readFileSync(erc721mgArtifactPath, "utf8"),
  );

  // Load Gateway ABI
  const gatewayArtifactPath = path.join(
    repoRoot,
    "artifacts",
    "contracts",
    "gateways",
    "AuthorityMintGateway.fhe.faucet.sol",
    "AuthorityMintGateway.json",
  );
  const gatewayArtifact = JSON.parse(
    fs.readFileSync(gatewayArtifactPath, "utf8"),
  );

  const erc721mg = new ethers.Contract(
    erc721mgAddress,
    erc721mgArtifact.abi,
    deployer,
  );

  const gateway = new ethers.Contract(
    gatewayAddress,
    gatewayArtifact.abi,
    deployer,
  );

  console.log("📋 Contract Addresses:");
  console.log("ERC721MG:", erc721mgAddress);
  console.log("Gateway:", gatewayAddress);

  try {
    // 1. Set Gateway as minter on ERC721MG
    console.log("\n1️⃣ Setting Gateway as minter on ERC721MG...");
    const tx1 = await erc721mg.setMinter(gatewayAddress, true);
    console.log("📤 Tx:", tx1.hash);
    const receipt1 = await tx1.wait();
    console.log("✅ Gateway set as minter!");
    console.log("Block:", receipt1.blockNumber);

    // 2. Allow ERC721MG in Gateway
    console.log("\n2️⃣ Allowing ERC721MG in Gateway...");
    const tx2 = await gateway.setCollectionAllowed(erc721mgAddress, true);
    console.log("📤 Tx:", tx2.hash);
    const receipt2 = await tx2.wait();
    console.log("✅ ERC721MG allowed in Gateway!");
    console.log("Block:", receipt2.blockNumber);

    // Verify setup
    const isMinter = await erc721mg.minters(gatewayAddress);
    const isAllowed = await gateway.collectionAllowed(erc721mgAddress);
    console.log("\n🔍 Verification:");
    console.log("Gateway is minter on ERC721MG:", isMinter);
    console.log("ERC721MG is allowed in Gateway:", isAllowed);

    if (isMinter && isAllowed) {
      console.log("\n🎉 Setup completed successfully!");
      console.log("🔗 Gateway can now mint ERC721MG tokens");
    } else {
      console.log("\n❌ Setup verification failed");
    }
  } catch (error) {
    console.error("❌ Error during setup:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
