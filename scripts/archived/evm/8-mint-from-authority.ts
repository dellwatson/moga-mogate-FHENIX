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
  const authorityMintAddress = process.env.AUTHORITY_MINT_ADDRESS;
  const toAddress = process.env.MINT_TO || second.address;
  const tokenUri = process.env.TOKEN_URI;
  const tokenIdEnv = process.env.TOKEN_ID;

  if (!collectionAddress)
    throw new Error("COLLECTION_ADDRESS env var is required");
  if (!authorityMintAddress)
    throw new Error("AUTHORITY_MINT_ADDRESS env var is required");
  if (!tokenUri) throw new Error("TOKEN_URI env var is required");

  const nowMs = Date.now();
  const tokenId = tokenIdEnv ? BigInt(tokenIdEnv) : BigInt(nowMs);

  console.log("Deployer:", deployer.address);
  console.log("Second (recipient default):", second.address);
  console.log("Minting to:", toAddress);
  console.log("Collection:", collectionAddress);
  console.log("AuthorityMint:", authorityMintAddress);
  console.log("TokenId:", tokenId.toString());
  console.log("TokenURI:", tokenUri);

  // Ensure AuthorityMint is a minter in the Collection
  const collectionOwner = new ethers.Contract(
    collectionAddress,
    ["function setMinter(address minter, bool allowed) external"],
    deployer
  );

  const setMinterTx = await collectionOwner.setMinter(
    authorityMintAddress,
    true
  );
  console.log("setMinter(AuthorityMint) tx:", setMinterTx.hash);
  await setMinterTx.wait();

  const authorityMint = new ethers.Contract(
    authorityMintAddress,
    [
      "function mint(address to, string uri, uint256 tokenId) external returns (uint256)",
    ],
    deployer
  );

  const tx = await authorityMint.mint(toAddress, tokenUri, tokenId);
  console.log("Authority mint tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Authority mint confirmed in block", receipt.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
