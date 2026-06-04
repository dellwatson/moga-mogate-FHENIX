import { ethers } from "ethers";

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const pk = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY_ETH;
  const tokenUri = process.env.TOKEN_URI;
  const tokenIdEnv = process.env.TOKEN_ID;
  const gatewayAddress = process.env.AUTHORITY_GATEWAY_ADDRESS;
  const collectionAddress = process.env.COLLECTION_ADDRESS;
  const toEnv = process.env.MINT_TO;

  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL env var is required");
  if (!pk)
    throw new Error(
      "SEPOLIA_PRIVATE_KEY or PRIVATE_KEY_ETH env var is required"
    );
  if (!gatewayAddress)
    throw new Error("AUTHORITY_GATEWAY_ADDRESS env var is required");
  if (!collectionAddress)
    throw new Error("COLLECTION_ADDRESS env var is required");
  if (!tokenUri) throw new Error("TOKEN_URI env var is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);

  const nowMs = Date.now();
  const tokenId = tokenIdEnv ? BigInt(tokenIdEnv) : BigInt(nowMs);

  const to = toEnv || signer.address;

  console.log("Signer:", signer.address);
  console.log("Gateway:", gatewayAddress);
  console.log("Collection:", collectionAddress);
  console.log("Minting to:", to);
  console.log("TokenId:", tokenId.toString());
  console.log("TokenURI:", tokenUri);

  const gateway = new ethers.Contract(
    gatewayAddress,
    [
      "function mint_nft(address collection, address to, string uri, uint256 tokenId) external returns (uint256)",
    ],
    signer
  );

  const tx = await gateway.mint_nft(collectionAddress, to, tokenUri, tokenId);
  console.log("gateway.mint_nft tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("gateway.mint_nft confirmed in block", receipt.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
