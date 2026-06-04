import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const pk = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY_ETH;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL env var is required");
  if (!pk)
    throw new Error(
      "SEPOLIA_PRIVATE_KEY or PRIVATE_KEY_ETH env var is required"
    );

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(pk, provider);
  console.log(
    "Deploying AuthorityMintWithPermit with:",
    await deployer.getAddress()
  );

  const collectionAddress = process.env.COLLECTION_ADDRESS;
  const backendSigner = process.env.BACKEND_SIGNER_ADDRESS;

  if (!collectionAddress) {
    throw new Error(
      "COLLECTION_ADDRESS env var must be set to the deployed Collection address"
    );
  }
  if (!backendSigner) {
    throw new Error(
      "BACKEND_SIGNER_ADDRESS env var must be set to the backend signer EOA address"
    );
  }

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const repoRoot = path.join(__dirname, "..", "..");
  const artifactPath = path.join(
    repoRoot,
    "artifacts",
    "contracts",
    "AuthorityMintWithPermit.sol",
    "AuthorityMintWithPermit.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    deployer
  );
  const authorityMintWithPermit = await factory.deploy(
    backendSigner,
    collectionAddress
  );
  const receipt = await authorityMintWithPermit.deploymentTransaction()?.wait();

  const address = await authorityMintWithPermit.getAddress();

  console.log("AuthorityMintWithPermit deployed to:", address);
  if (receipt) {
    console.log("Deploy tx:", receipt.hash, "block:", receipt.blockNumber);
  }
  console.log(
    "Remember to whitelist this address as a minter in Collection.setMinter"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
