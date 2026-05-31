const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  console.log("🔧 Setting up minter roles for new contracts...");

  // Connect to Sepolia
  const provider = new ethers.JsonRpcProvider(
    process.env.SEPOLIA_RPC_URL ||
      "https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
  );
  const privateKey = process.env.PRIVATE_KEY_ETH || process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.error("❌ No private key found! Set PRIVATE_KEY_ETH in .env file");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log("👤 Account:", wallet.address);

  // Contract addresses
  const ERC721MG_ADDRESS = "0x4cf031C2ecf8ee6b08bF7ab16a49636A0FADBF9D";
  const GATEWAY_ADDRESS = "0xA91D70aE85af28Efc23D5d90348a72A08C56056A";

  // Load ABIs
  const erc721mgArtifact = require("/Users/dellwatson/Desktop/MOGATE_DEFI/mogate-rwa-raffle-monorepo-ETH/artifacts/contracts/ERC721MG.sol/ERC721MG.json");
  const gatewayArtifact = require("/Users/dellwatson/Desktop/MOGATE_DEFI/mogate-rwa-raffle-monorepo-ETH/artifacts/contracts/gateways/AuthorityMintGateway.fhe.faucet.sol/AuthorityMintGateway.json");

  // Create contract instances
  const erc721mg = new ethers.Contract(
    ERC721MG_ADDRESS,
    erc721mgArtifact.abi,
    wallet,
  );
  const gateway = new ethers.Contract(
    GATEWAY_ADDRESS,
    gatewayArtifact.abi,
    wallet,
  );

  console.log("\n📋 Contract Addresses:");
  console.log("ERC721MG:", ERC721MG_ADDRESS);
  console.log("Gateway:", GATEWAY_ADDRESS);

  try {
    // 1. Set Gateway as Minter on ERC721MG
    console.log("\n1️⃣ Setting Gateway as minter on ERC721MG...");
    const tx1 = await erc721mg.setMinter(GATEWAY_ADDRESS, true);
    console.log("📤 Tx:", tx1.hash);
    await tx1.wait();
    console.log("✅ Gateway is now minter on ERC721MG");

    // 2. Allow ERC721MG in Gateway
    console.log("\n2️⃣ Allowing ERC721MG in Gateway...");
    const tx2 = await gateway.setCollectionAllowed(ERC721MG_ADDRESS, true);
    console.log("📤 Tx:", tx2.hash);
    await tx2.wait();
    console.log("✅ ERC721MG is now allowed in Gateway");

    // 3. Verify setup
    console.log("\n3️⃣ Verifying setup...");
    const isMinter = await erc721mg.minters(GATEWAY_ADDRESS);
    const isAllowed = await gateway.collectionAllowed(ERC721MG_ADDRESS);

    console.log("🔍 Gateway is minter on ERC721MG:", isMinter);
    console.log("🔍 ERC721MG is allowed in Gateway:", isAllowed);

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
