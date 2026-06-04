import { ethers } from "ethers";

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL env var is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const txHash = process.env.TX_HASH;
  const collectionAddressEnv = process.env.COLLECTION_ADDRESS || "";
  const standard = (process.env.NFT_STANDARD || "ERC721").toUpperCase();

  if (!txHash) {
    throw new Error("TX_HASH env var is required");
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error("Transaction receipt not found");
  }

  console.log("Tx block:", receipt.blockNumber);

  const zero = ethers.ZeroAddress;

  if (standard === "ERC721") {
    const erc721Iface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ]);

    let collectionAddress = collectionAddressEnv.toLowerCase();
    let from = "";
    let tokenId: bigint | null = null;

    for (const log of receipt.logs) {
      if (collectionAddress && log.address.toLowerCase() !== collectionAddress)
        continue;

      try {
        const parsed = erc721Iface.parseLog({
          data: log.data,
          topics: log.topics,
        });
        if (parsed.name !== "Transfer") continue;

        const to = parsed.args.to as string;
        if (to.toLowerCase() !== zero.toLowerCase()) continue; // not a burn

        from = parsed.args.from as string;
        tokenId = parsed.args.tokenId as bigint;
        collectionAddress = log.address.toLowerCase();
        break;
      } catch {
        continue;
      }
    }

    if (!tokenId) {
      throw new Error("No ERC721 burn Transfer event found in this tx");
    }

    console.log("Detected ERC721 burn:");
    console.log("  collection:", collectionAddress);
    console.log("  from:", from);
    console.log("  tokenId:", tokenId.toString());

    const collection = new ethers.Contract(
      collectionAddress,
      ["function tokenURI(uint256 tokenId) view returns (string)"],
      provider
    );

    const blockTag = receipt.blockNumber - 1;
    const uri = await collection.tokenURI(tokenId, { blockTag });
    console.log("  tokenURI (pre-burn):", uri);
  } else if (standard === "ERC1155") {
    const erc1155Iface = new ethers.Interface([
      "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
    ]);

    let collectionAddress = collectionAddressEnv.toLowerCase();
    let from = "";
    let id: bigint | null = null;
    let value: bigint | null = null;

    for (const log of receipt.logs) {
      if (collectionAddress && log.address.toLowerCase() !== collectionAddress)
        continue;

      try {
        const parsed = erc1155Iface.parseLog({
          data: log.data,
          topics: log.topics,
        });
        if (parsed.name !== "TransferSingle") continue;

        const to = parsed.args.to as string;
        if (to.toLowerCase() !== zero.toLowerCase()) continue; // not a burn

        from = parsed.args.from as string;
        id = parsed.args.id as bigint;
        value = parsed.args.value as bigint;
        collectionAddress = log.address.toLowerCase();
        break;
      } catch {
        continue;
      }
    }

    if (id === null || value === null) {
      throw new Error("No ERC1155 burn TransferSingle event found in this tx");
    }

    console.log("Detected ERC1155 burn:");
    console.log("  collection:", collectionAddress);
    console.log("  from:", from);
    console.log("  id:", id.toString());
    console.log("  amount:", value.toString());

    const collection = new ethers.Contract(
      collectionAddress,
      ["function uri(uint256 id) view returns (string)"],
      provider
    );

    const blockTag = receipt.blockNumber - 1;
    const uri = await collection.uri(id, { blockTag });
    console.log("  uri (pre-burn):", uri);
  } else {
    throw new Error(`Unsupported NFT_STANDARD: ${standard}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
