import { ethers } from "ethers";
import { fheNftConfig } from "../config.js";

async function main() {
  const { network, erc721mg } = fheNftConfig;

  const rpcUrl = network.rpcUrls[network.target];
  const pk = network.privateKey;

  const collectionAddress =
    erc721mg.latestCollectionAddress || erc721mg.collectionAddress;
  const tokenId = erc721mg.decrypt.tokenId;

  if (!rpcUrl)
    throw new Error(
      `RPC URL for target network '${network.target}' is required`,
    );
  if (!pk)
    throw new Error("PRIVATE_KEY_ETH or PRIVATE_KEY_ETH_2 env var is required");
  if (!collectionAddress)
    throw new Error("fheNftConfig.erc721mg.collectionAddress is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);

  console.log("Redeeming token to soulbound with signer:", signer.address);
  console.log("Collection:", collectionAddress);
  console.log("TokenId:", tokenId.toString());

  const collection = new ethers.Contract(
    collectionAddress,
    [
      "function unwrap(uint256 tokenId) external",
      "function ownerOf(uint256 tokenId) view returns (address)",
      "function balanceOf(address owner) view returns (uint256)",
    ],
    signer,
  );

  // Check if token exists and who owns it
  try {
    const owner = await collection.ownerOf(tokenId);
    console.log("Token owner:", owner);
    console.log("Signer address:", signer.address);
    console.log(
      "Is signer the owner?",
      owner.toLowerCase() === signer.address.toLowerCase(),
    );

    const balance = await collection.balanceOf(signer.address);
    console.log("Signer balance:", balance.toString());
  } catch (err) {
    console.error("Error checking token:", err.message);
  }

  const tx = await collection.unwrap(tokenId);
  console.log("unwrap tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
