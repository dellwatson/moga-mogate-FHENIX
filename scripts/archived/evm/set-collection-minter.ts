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

  console.log("Setting minter with:", await deployer.getAddress());

  // NEW contract addresses
  const erc721mgAddress = "0x4cf031C2ecf8ee6b08bF7ab16a49636A0FADBF9D";
  const gatewayAddress = "0xA91D70aE85af28Efc23D5d90348a72A08C56056A";

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
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

  console.log("Setting up minter permissions...");
  console.log("ERC721MG:", erc721mgAddress);
  console.log("Gateway:", gatewayAddress);

  // 1. Set Gateway as minter on ERC721MG
  console.log("\n1️⃣ Setting Gateway as minter on ERC721MG...");
  const tx1 = await erc721mg.setMinter(gatewayAddress, true);
  const receipt1 = await tx1.wait();
  console.log("✅ Gateway set as minter!");
  console.log("Tx hash:", receipt1.hash);

  // 2. Allow ERC721MG in Gateway
  console.log("\n2️⃣ Allowing ERC721MG in Gateway...");
  const tx2 = await gateway.setCollectionAllowed(erc721mgAddress, true);
  const receipt2 = await tx2.wait();
  console.log("✅ ERC721MG allowed in Gateway!");
  console.log("Tx hash:", receipt2.hash);

  // Verify setup
  const isMinter = await erc721mg.minters(gatewayAddress);
  const isAllowed = await gateway.collectionAllowed(erc721mgAddress);
  console.log("\n🔍 Verification:");
  console.log("Gateway is minter on ERC721MG:", isMinter);
  console.log("ERC721MG is allowed in Gateway:", isAllowed);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
