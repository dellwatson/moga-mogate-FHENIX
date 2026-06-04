import { ethers } from "ethers";

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const pkOwner =
    process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY_ETH;
  const pkSecond = process.env.PRIVATE_KEY_ETH_2;

  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL env var is required");
  if (!pkOwner)
    throw new Error(
      "SEPOLIA_PRIVATE_KEY or PRIVATE_KEY_ETH env var is required"
    );
  if (!pkSecond) throw new Error("PRIVATE_KEY_ETH_2 env var is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(pkOwner, provider);
  const second = new ethers.Wallet(pkSecond, provider);

  const collectionAddress = process.env.COLLECTION_ADDRESS;
  const toAddress = process.env.MINT_TO || second.address;
  const tokenUri = process.env.TOKEN_URI;
  const tokenIdEnv = process.env.TOKEN_ID;

  if (!collectionAddress)
    throw new Error("COLLECTION_ADDRESS env var is required");
  if (!tokenUri) throw new Error("TOKEN_URI env var is required");

  const nowMs = Date.now();
  const tokenId = tokenIdEnv ? BigInt(tokenIdEnv) : BigInt(nowMs);

  console.log("Deployer:", deployer.address);
  console.log("Minter (second):", second.address);
  console.log("Minting to:", toAddress);
  console.log("Collection:", collectionAddress);
  console.log("TokenId:", tokenId.toString());
  console.log("TokenURI:", tokenUri);

  const collectionOwner = new ethers.Contract(
    collectionAddress,
    [
      "function setMinter(address minter, bool allowed) external",
      "function mintWithTokenId(address to, uint256 tokenId, string uri) external returns (uint256)",
    ],
    deployer
  );

  const minterAddress = second.address;
  const setMinterTx = await collectionOwner.setMinter(minterAddress, true);
  console.log("setMinter tx:", setMinterTx.hash);
  await setMinterTx.wait();

  const collectionAsMinter = collectionOwner.connect(second);

  const tx = await collectionAsMinter.mintWithTokenId(
    toAddress,
    tokenId,
    tokenUri
  );
  console.log("Mint tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Mint confirmed in block", receipt.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
