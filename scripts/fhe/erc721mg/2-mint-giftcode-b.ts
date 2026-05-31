import fs from "node:fs";
import * as path from "path";
import { ethers } from "ethers";
import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { Encryptable } from "@cofhe/sdk";
import { chains } from "@cofhe/sdk/chains";
import { fheNftConfig } from "../config.js";

type InEuint128Input = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
};

const PVT_KEY_COFHE =
  "364a65586e98db188093866aec0f0768d42a02e1a7f90e8ad9a46db3a1767b16"; //0xAlc
// "7c58a138f6c6453b7c457f232338d51dd6698e7a27dc8f158d8aa272bc8a9b3e"; //0x31
const PVT_KEY_MINTER =
  "7c58a138f6c6453b7c457f232338d51dd6698e7a27dc8f158d8aa272bc8a9b3e"; //0x31

async function main() {
  const { network, erc721mg } = fheNftConfig;
  const { mint } = erc721mg;

  const rpcUrl = network.rpcUrls[network.target];
  const pkMint = PVT_KEY_MINTER; // for minting transactions
  const pkCofhe = PVT_KEY_COFHE; // for CoFHE encryption

  const collectionAddress =
    erc721mg.latestCollectionAddress || erc721mg.collectionAddress;
  const to = mint.to;
  const uri = mint.uri;
  const existingCipherRef = mint.cipherRef || "";
  const plaintextGiftcode = mint.plaintextGiftcode;

  if (!rpcUrl)
    throw new Error(
      `RPC URL for target network '${network.target}' is required`,
    );
  if (!pkMint)
    throw new Error(
      "PRIVATE_KEY_ETH or PRIVATE_KEY_ETH_2 env var is required for minting",
    );
  if (!pkCofhe)
    throw new Error(
      "BACKEND_PRIVATE_KEY or PRIVATE_KEY_ETH env var is required for CoFHE encryption",
    );
  if (!collectionAddress)
    throw new Error("fheNftConfig.erc721mg.collectionAddress is required");
  if (!to) throw new Error("fheNftConfig.erc721mg.mint.to is required");
  if (!uri) throw new Error("fheNftConfig.erc721mg.mint.uri is required");

  // Separate signers
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signerMint = new ethers.Wallet(pkMint, provider); // wallet for minting

  console.log(
    "Minting ERC721MG giftcode with minter signer:",
    signerMint.address,
  );
  console.log("Collection:", collectionAddress);
  console.log("Recipient:", to);
  if (plaintextGiftcode) {
    console.log("Giftcode (plaintext, off-chain):", plaintextGiftcode);
  }

  // CoFHE client for encrypting the AES key (using separate key)
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const cofheAccount = privateKeyToAccount(
    pkCofhe.startsWith("0x")
      ? (pkCofhe as `0x${string}`)
      : (`0x${pkCofhe}` as `0x${string}`),
  );
  const cofheWalletClient = createWalletClient({
    account: cofheAccount,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const cofheConfig = createCofheConfig({
    supportedChains: [chains.sepolia],
  });
  const cofheClient = createCofheClient(cofheConfig);

  await cofheClient.connect(publicClient, cofheWalletClient); // this wallet for cofhe encryption
  console.log("CoFHE encryption wallet:", cofheAccount.address);

  // Generate random AES key for each mint (16 bytes = 128 bits)
  const aesKeyBytes = crypto.getRandomValues(new Uint8Array(16));
  const aesKeyHex = Array.from(aesKeyBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const aesKeyBigInt = BigInt("0x" + aesKeyHex);

  console.log("Generated AES key (hex):", "0x" + aesKeyHex);

  // ACTUALLY ENCRYPT THE GIFTCODE WITH AES
  const giftcode = mint.plaintextGiftcode;
  console.log("Giftcode (plaintext):", giftcode);

  // Simple AES encryption using Web Crypto API
  const encoder = new TextEncoder();
  const giftcodeData = encoder.encode(giftcode);

  // Import AES key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  // Encrypt giftcode
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
  const encryptedGiftcode = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    giftcodeData,
  );

  // Store encrypted giftcode and IV together
  const encryptedPayload = new Uint8Array(
    iv.length + encryptedGiftcode.byteLength,
  );
  encryptedPayload.set(iv);
  encryptedPayload.set(new Uint8Array(encryptedGiftcode), iv.length);

  // Save to local file (in production, use IPFS)
  const cipherRef = `giftcode_${Date.now()}.bin`;
  await fs.promises.writeFile(cipherRef, encryptedPayload);
  console.log("Encrypted giftcode saved to:", cipherRef);

  console.log("Encrypting AES key with CoFHE...");
  const [encKey] = await cofheClient
    .encryptInputs([Encryptable.uint128(aesKeyBigInt)])
    .setAccount(signerMint.address)
    .execute();

  console.log("encKey type:", typeof encKey);
  console.log("encKey:", encKey);

  if (encKey.ctHash === undefined || !encKey.signature) {
    throw new Error(
      "Invalid CoFHE encrypted input: missing ctHash/signature. Ensure the wallet used for encryption is connected and signs input proofs.",
    );
  }

  // IMPORTANT: InEuint128 is (uint256 ctHash, uint8 securityZone, uint8 utype, bytes signature).
  // Do not pass the older (bytes data, int32 securityZone, ...) tuple shape.
  const encKeyForContract: InEuint128Input = {
    ctHash: BigInt(encKey.ctHash),
    securityZone: Number(encKey.securityZone ?? 0),
    utype: Number(encKey.utype ?? 6),
    signature: String(encKey.signature ?? "0x"),
  };

  console.log("encKeyForContract:", encKeyForContract);

  const collection = new ethers.Contract(
    collectionAddress,
    [
      "function setMinter(address minter, bool allowed) external",
      "function owner() view returns (address)",
      "function operators(address) view returns (bool)",
      "function minters(address) view returns (bool)",
      "function mint(address to, string uri, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encKey, string cipherRef) external returns (uint256)",
    ],
    signerMint, // use the minter signer for contract calls
  );

  // Ensure minter signer is a minter. Only owner/operator can grant this role.
  const isMinter = await collection.minters(signerMint.address);
  if (!isMinter) {
    const [ownerAddress, isOperator] = await Promise.all([
      collection.owner(),
      collection.operators(signerMint.address),
    ]);
    const canGrantRole =
      ownerAddress.toLowerCase() === signerMint.address.toLowerCase() ||
      isOperator;
    if (!canGrantRole) {
      throw new Error(
        `Minter signer ${signerMint.address} is not a minter and cannot call setMinter. Ask owner/operator to whitelist this wallet first.`,
      );
    }
    const txRole = await collection.setMinter(signerMint.address, true);
    console.log("setMinter tx:", txRole.hash);
    await txRole.wait();
  } else {
    console.log("Minter signer already has minter role; skipping setMinter.");
  }

  console.log("Calling mint...");
  const tx = await collection.mint(to, uri, encKeyForContract, cipherRef);
  console.log("mint tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // Derive the newly minted tokenId from the ERC721 Transfer event and persist it
  const erc721Iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ]);

  let mintedTokenId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = erc721Iface.parseLog(log);
      if (
        parsed.name === "Transfer" &&
        parsed.args.from === ethers.ZeroAddress &&
        String(parsed.args.to).toLowerCase() === to.toLowerCase()
      ) {
        mintedTokenId = parsed.args.tokenId as bigint;
        break;
      }
    } catch {
      // ignore non-ERC721 logs
    }
  }

  if (mintedTokenId !== null) {
    console.log("Minted tokenId:", mintedTokenId.toString());

    // Update config with new token info
    const __dirname = path.dirname(new URL(import.meta.url).pathname);
    const configPath = path.join(__dirname, "..", "config.js");

    try {
      // Read current config
      const configContent = fs.readFileSync(configPath, "utf8");

      // Read the encrypted file to get ciphertext as hex
      const encryptedData = fs.readFileSync(cipherRef);
      const ciphertextHex = Buffer.from(encryptedData).toString("hex");

      // Update the decrypt section with new token info (giftcode comes from mint config)
      const updatedConfig = configContent.replace(
        /decrypt: \{[\s\S]*?tokenId: \d+[\s\S]*?\}/,
        `decrypt: {\n    tokenId: ${mintedTokenId},\n    cipherRef: "${cipherRef}",\n    aesKeyHex: "0x${aesKeyHex}", // For testing only\n    ciphertextHex: "${ciphertextHex}" // Encrypted giftcode as hex\n  }`,
      );

      fs.writeFileSync(configPath, updatedConfig, "utf8");
      console.log("Updated config with new token info");

      // Also update the state file
      const statePath = path.join(__dirname, "..", "erc721mg_state.json");
      fs.writeFileSync(
        statePath,
        JSON.stringify({ lastTokenId: mintedTokenId.toString() }, null, 2),
        "utf8",
      );
      console.log("Updated state file:", statePath);
    } catch (err) {
      console.error("Failed to update config", err);
    }
  } else {
    console.warn(
      "Could not infer minted tokenId from logs; decrypt script will keep previous value.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
