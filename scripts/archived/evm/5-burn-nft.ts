import { ethers } from "ethers";

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const pkSecond = process.env.PRIVATE_KEY_ETH_2;

  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL env var is required");
  if (!pkSecond) throw new Error("PRIVATE_KEY_ETH_2 env var is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pkSecond, provider);
  console.log("Using signer (second account):", signer.address);

  const standard = (process.env.NFT_STANDARD || "ERC721").toUpperCase();
  const collectionAddress = process.env.COLLECTION_ADDRESS;
  const tokenIdEnv = process.env.TOKEN_ID;
  const amountEnv = process.env.AMOUNT || "1";

  if (!collectionAddress) {
    throw new Error("COLLECTION_ADDRESS env var is required");
  }
  if (!tokenIdEnv) {
    throw new Error("TOKEN_ID env var is required");
  }

  const tokenId = BigInt(tokenIdEnv);

  if (standard === "ERC721") {
    const abi = ["function burn(uint256 tokenId) external"];
    const collection = new ethers.Contract(collectionAddress, abi, signer);

    console.log(`Burning ERC721 token ${tokenId} on ${collectionAddress}...`);
    const tx = await collection.burn(tokenId);
    console.log("Tx submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("Tx confirmed in block", receipt.blockNumber);
  } else if (standard === "ERC1155") {
    const abi = [
      "function burn(address from, uint256 id, uint256 amount) external",
    ];
    const collection = new ethers.Contract(collectionAddress, abi, signer);
    const amount = BigInt(amountEnv);
    const from = signer.address;

    console.log(
      `Burning ERC1155 id ${tokenId} amount ${amount} from ${from} on ${collectionAddress}...`
    );
    const tx = await collection.burn(from, tokenId, amount);
    console.log("Tx submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("Tx confirmed in block", receipt.blockNumber);
  } else {
    throw new Error(`Unsupported NFT_STANDARD: ${standard}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
