import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { fheNftConfig } from "../config.js";

// Separate private keys for different operations
const PVT_KEY_COFHE =
  "364a65586e98db188093866aec0f0768d42a02e1a7f90e8ad9a46db3a1767b16"; //alc
const PVT_KEY_MINTER =
  "7c58a138f6c6453b7c457f232338d51dd6698e7a27dc8f158d8aa272bc8a9b3e"; //0x31

type EncPart = {
  name?: string;
  ctHash?: string | number | bigint;
  securityZone?: number;
  utype?: number;
  signature?: string;
  handle?: string;
};

type KeyHandlePayload = {
  scheme?: string;
  parts?: EncPart[];
};

type InEuint128Input = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
};

function selectEncPart(keyHandle: string): EncPart {
  try {
    const parsed = JSON.parse(keyHandle) as KeyHandlePayload;
    // Handle split-key format (with parts array)
    if (parsed && Array.isArray(parsed.parts) && parsed.parts.length > 0) {
      const low = parsed.parts.find((p) => p.name === "low");
      return low ?? parsed.parts[0];
    }
    // Handle single-key format (direct ctHash)
    if (parsed && parsed.ctHash) {
      return parsed;
    }
  } catch {
    // not JSON
  }
  throw new Error("key_handle must be JSON with ctHash or parts array");
}

function encKeyFromHandle(keyHandle: string): InEuint128Input {
  const part = selectEncPart(keyHandle);
  if (!part.ctHash || !part.signature) {
    throw new Error("key_handle part missing ctHash/signature");
  }
  return {
    ctHash: BigInt(part.ctHash),
    securityZone: Number(part.securityZone ?? 0),
    utype: Number(part.utype ?? 6),
    signature: String(part.signature),
  };
}

function deriveFieldsFromSample(samplePath: string) {
  const raw = fs.readFileSync(samplePath, "utf8");
  const data = JSON.parse(raw);

  // Use only the prepared data, not permit execution data (which is for old system)
  const to = data.prepared?.receiver_wallet ?? "";
  const uri = data.prepared?.metadata?.upload?.url ?? "";
  const cipherRef = data.prepared?.encryption?.cipher_ref ?? "";
  const keyHandle = data.prepared?.encryption?.key_handle ?? "";

  if (!to) throw new Error("Missing recipient wallet in sample.json");
  if (!uri) throw new Error("Missing metadata URI in sample.json");
  if (!cipherRef) throw new Error("Missing cipher_ref in sample.json");
  if (!keyHandle) throw new Error("Missing key_handle in sample.json");

  return { to, uri, cipherRef, keyHandle };
}

function updateConfig(mintedTokenId: bigint, cipherRef: string) {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const configPath = path.join(__dirname, "..", "config.js");
  const content = fs.readFileSync(configPath, "utf8");

  let updated = content;
  const tokenReplaced = /tokenId:\s*\d+/.test(updated);
  updated = updated.replace(/tokenId:\s*\d+/, `tokenId: ${mintedTokenId}`);

  const cipherReplaced = /cipherRef:\s*"[^"]*"/.test(updated);
  updated = updated.replace(
    /cipherRef:\s*"[^"]*"/,
    `cipherRef: "${cipherRef}"`,
  );

  fs.writeFileSync(configPath, updated, "utf8");
  console.log(
    "Updated config.js decrypt block",
    `(tokenId ${tokenReplaced ? "replaced" : "missing match"}, cipherRef ${
      cipherReplaced ? "replaced" : "missing match"
    })`,
  );
}

async function main() {
  const { network, erc721mg } = fheNftConfig;
  const rpcUrl = network.rpcUrls[network.target];
  const pkMint = PVT_KEY_MINTER; // Use minter private key

  if (!rpcUrl)
    throw new Error(
      `RPC URL for target network '${network.target}' is required`,
    );
  if (!pkMint)
    throw new Error("PRIVATE_KEY_ETH or PRIVATE_KEY_ETH_2 env var is required");
  if (!erc721mg.latestCollectionAddress && !erc721mg.collectionAddress)
    throw new Error(
      "fheNftConfig.erc721mg.latestCollectionAddress is required",
    );

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const samplePath = path.join(__dirname, "..", "sample.json");
  const { to, uri, cipherRef, keyHandle } = deriveFieldsFromSample(samplePath);
  const encKeyForContract = encKeyFromHandle(keyHandle);

  // Use latest collection address if available
  const collectionAddress =
    erc721mg.latestCollectionAddress || erc721mg.collectionAddress;

  console.log("Mint-only mode using prepared payload");
  console.log("Recipient:", to);
  console.log("URI:", uri);
  console.log("CipherRef:", cipherRef);
  console.log("EncKey:", encKeyForContract);
  console.log("Collection:", collectionAddress);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pkMint, provider);

  const collection = new ethers.Contract(
    collectionAddress,
    [
      "function setMinter(address minter, bool allowed) external",
      "function owner() view returns (address)",
      "function operators(address) view returns (bool)",
      "function minters(address) view returns (bool)",
      "function mint(address to, string uri, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encKey, string cipherRef) external returns (uint256)",
    ],
    signer,
  );

  const isMinter = await collection.minters(signer.address);
  if (!isMinter) {
    const [ownerAddress, isOperator] = await Promise.all([
      collection.owner(),
      collection.operators(signer.address),
    ]);
    const canGrantRole =
      ownerAddress.toLowerCase() === signer.address.toLowerCase() || isOperator;
    if (!canGrantRole) {
      throw new Error(
        `Signer ${signer.address} is not a minter and cannot call setMinter. Ask owner/operator to whitelist this wallet first.`,
      );
    }
    const txRole = await collection.setMinter(signer.address, true);
    console.log("setMinter tx:", txRole.hash);
    await txRole.wait();
  } else {
    console.log("Signer already has minter role; skipping setMinter.");
  }

  console.log("Calling mint...");
  const tx = await collection.mint(to, uri, encKeyForContract, cipherRef);
  console.log("mint tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // derive tokenId from Transfer logs
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
      // ignore
    }
  }

  if (mintedTokenId !== null) {
    console.log("Minted tokenId:", mintedTokenId.toString());
    updateConfig(mintedTokenId, cipherRef);
  } else {
    console.warn(
      "Could not infer minted tokenId from logs; config.js was not updated.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
