import { ethers } from "ethers";
import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { FheTypes } from "@cofhe/sdk";
import { chains } from "@cofhe/sdk/chains";
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

  console.log("Decrypting giftcode for token:", tokenId.toString());
  console.log("Holder (signer):", signer.address);

  const collection = new ethers.Contract(
    collectionAddress,
    [
      "function encryptedKey(uint256 tokenId) external view returns (bytes)",
      "function cipherRef(uint256 tokenId) external view returns (string)",
      "function isUnwrapped(uint256 tokenId) external view returns (bool)",
      "function ownerOf(uint256 tokenId) external view returns (address)",
    ],
    signer,
  );

  // Use raw call to get bytes without ABI decoding
  const keyCallData = collection.interface.encodeFunctionData("encryptedKey", [
    tokenId,
  ]);
  const keyResult = await provider.call({
    to: collectionAddress,
    data: keyCallData,
  });
  const keyHandleBytes = keyResult;
  const cipherRef: string = await collection.cipherRef(tokenId);
  const isUnwrapped: boolean = await collection.isUnwrapped(tokenId);
  const owner: string = await collection.ownerOf(tokenId);

  console.log("cipherRef:", cipherRef || "<none>");
  console.log("encrypted key handle (bytes):", keyHandleBytes);
  console.log("isUnwrapped:", isUnwrapped);
  console.log("owner:", owner);
  console.log("signer:", signer.address);
  console.log(
    "signer is owner:",
    owner.toLowerCase() === signer.address.toLowerCase(),
  );

  // CoFHE client for decrypting the key
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const account = privateKeyToAccount(
    pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`),
  );
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const cofheConfig = createCofheConfig({
    supportedChains: [chains.sepolia],
  });
  const cofheClient = createCofheClient(cofheConfig);

  await cofheClient.connect(publicClient, walletClient);
  console.log("FHE client connected successfully");

  console.log("Creating FHE permit for account...");
  await cofheClient.permits.getOrCreateSelfPermit();
  console.log("FHE permit created successfully");

  // The new contract returns only the ctHash (32 bytes) from the euint128
  const keyBytes = ethers.getBytes(keyHandleBytes);
  console.log("Raw key bytes length:", keyBytes.length);

  // Extract ctHash as hex string
  const ctHashHex = ethers.hexlify(keyBytes);
  console.log("ctHash hex:", ctHashHex);

  // Since the token is unwrapped, FHE access has been granted
  // Try decrypting directly with the ctHash
  console.log("Calling decryptForView with ctHash...");
  const aesKeyBigInt = await cofheClient
    .decryptForView(ctHashHex, FheTypes.Uint128)
    .execute();

  console.log("Decrypted AES key (uint128 as bigint):", aesKeyBigInt);

  // NOW ACTUALLY DECRYPT THE GIFTCODE
  if (cipherRef && cipherRef !== "<none>") {
    try {
      console.log("Decrypting giftcode from cipherRef:", cipherRef);

      // Read encrypted giftcode file
      const fs = await import("fs/promises");
      const encryptedData = await fs.readFile(cipherRef);

      // Convert bigint AES key to bytes (16 bytes for AES-128)
      const aesKeyHex = aesKeyBigInt.toString(16).padStart(32, "0");
      const aesKeyBytes = new Uint8Array(16);
      for (let i = 0; i < 32; i += 2) {
        aesKeyBytes[i / 2] = parseInt(aesKeyHex.substr(i, 2), 16);
      }
      console.log("AES key hex:", aesKeyHex);
      console.log("AES key bytes:", new Uint8Array(aesKeyBytes));

      // Extract IV and encrypted data
      const iv = encryptedData.slice(0, 12);
      const ciphertext = encryptedData.slice(12);

      // Import AES key
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        aesKeyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );

      // Decrypt giftcode
      const decryptedGiftcode = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        ciphertext,
      );

      const decoder = new TextDecoder();
      const giftcode = decoder.decode(decryptedGiftcode);

      console.log("🎉 SUCCESS! Decrypted giftcode:", giftcode);
    } catch (error) {
      console.error("Failed to decrypt giftcode:", error);
    }
  } else {
    console.log("No cipherRef available - cannot decrypt giftcode");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
