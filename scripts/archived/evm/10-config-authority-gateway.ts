import { ethers } from "ethers";

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const pk = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY_ETH;

  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL env var is required");
  if (!pk)
    throw new Error(
      "SEPOLIA_PRIVATE_KEY or PRIVATE_KEY_ETH env var is required"
    );

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);

  const gatewayAddress = process.env.AUTHORITY_GATEWAY_ADDRESS;
  const collectionAddress = process.env.COLLECTION_ADDRESS;

  if (!gatewayAddress)
    throw new Error("AUTHORITY_GATEWAY_ADDRESS env var is required");
  if (!collectionAddress)
    throw new Error("COLLECTION_ADDRESS env var is required");

  console.log("Configuring AuthorityMintGateway with signer:", signer.address);
  console.log("Gateway:", gatewayAddress);
  console.log("Collection:", collectionAddress);

  const gateway = new ethers.Contract(
    gatewayAddress,
    [
      "function setCollectionAllowed(address collection, bool allowed) external",
    ],
    signer
  );

  const collection = new ethers.Contract(
    collectionAddress,
    ["function setMinter(address minter, bool allowed) external"],
    signer
  );

  const allowTx = await gateway.setCollectionAllowed(collectionAddress, true);
  console.log("setCollectionAllowed tx:", allowTx.hash);
  await allowTx.wait();

  const minterTx = await collection.setMinter(gatewayAddress, true);
  console.log("setMinter(gateway) tx:", minterTx.hash);
  await minterTx.wait();

  console.log("AuthorityMintGateway configuration complete");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
