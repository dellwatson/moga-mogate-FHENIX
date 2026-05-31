import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { fheNftConfig } from "../config.js";

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
  ctHash?: string | number | bigint;
  securityZone?: number;
  utype?: number;
  signature?: string;
};

type InEuint128Input = {
  ctHash: bigint;
  securityZone: number;
  utype: number;
  signature: string;
};

const DEFAULT_GATEWAY_ADDRESS = "0xA91D70aE85af28Efc23D5d90348a72A08C56056A";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const invalidSignerIface = new ethers.Interface([
  "error InvalidSigner(address signer, address expected)",
]);

function getGatewayAddress(erc721mg: any): string {
  return (
    process.env.AUTHORITY_GATEWAY_ADDRESS ||
    process.env.ERC721MG_GATEWAY_ADDRESS ||
    erc721mg.gatewayAddress ||
    DEFAULT_GATEWAY_ADDRESS
  );
}

function getMintMethod(): "unsafeMint" | "unsafeCheckout" {
  const method = process.env.FHE_GATEWAY_MINT_METHOD || "unsafeCheckout";
  if (method !== "unsafeMint" && method !== "unsafeCheckout") {
    throw new Error(
      "FHE_GATEWAY_MINT_METHOD must be either 'unsafeMint' or 'unsafeCheckout'",
    );
  }
  return method;
}

function selectEncPart(keyHandle: string): EncPart {
  try {
    const parsed = JSON.parse(keyHandle) as KeyHandlePayload;
    if (parsed && Array.isArray(parsed.parts) && parsed.parts.length > 0) {
      const low = parsed.parts.find((p) => p.name === "low");
      return low ?? parsed.parts[0];
    }
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

function updateState(mintedTokenId: bigint) {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const statePath = path.join(__dirname, "..", "erc721mg_state.json");
  fs.writeFileSync(
    statePath,
    JSON.stringify({ lastTokenId: mintedTokenId.toString() }, null, 2),
    "utf8",
  );
  console.log("Updated state file:", statePath);
}

function getRevertMessage(err: unknown): string {
  const error = err as any;
  if (typeof error?.data === "string") {
    try {
      const decoded = invalidSignerIface.parseError(error.data);
      if (decoded?.name === "InvalidSigner") {
        return [
          "FHE encrypted input is not valid for the gateway caller.",
          `Recovered signer: ${decoded.args.signer}`,
          `Expected verifier: ${decoded.args.expected}`,
          `Regenerate sample.json with CoFHE setAccount(${fheNftConfig.erc721mg.gatewayAddress}) for gateway minting.`,
        ].join("\n");
      }
    } catch {
      // Unknown custom error; fall through to generic handling.
    }
  }
  return (
    error?.shortMessage ||
    error?.reason ||
    error?.info?.error?.message ||
    error?.message ||
    String(err)
  );
}

async function main() {
  const { network, erc721mg } = fheNftConfig;
  const { mint } = erc721mg;

  const rpcUrl = network.rpcUrls[network.target];
  const pk = network.backendPrivateKey || network.privateKey;
  const collectionAddress =
    erc721mg.gatewayCollectionAddress || erc721mg.latestCollectionAddress;
  const gatewayAddress = getGatewayAddress(erc721mg);
  const mintMethod = getMintMethod();
  const dryRun = ["1", "true", "yes"].includes(
    (process.env.FHE_GATEWAY_DRY_RUN || "").toLowerCase(),
  );

  // Load data from sample.json like 2c-mint-only.ts
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const samplePath = path.join(__dirname, "..", "sample.json");
  const sampleData = JSON.parse(fs.readFileSync(samplePath, "utf8"));

  const to = sampleData.prepared?.receiver_wallet || mint.to;
  const uri = sampleData.prepared?.metadata?.upload?.url || mint.uri;
  const orderId =
    sampleData.checkout_id ||
    sampleData.prepared?.permit?.permit_id ||
    `manual-${Date.now()}`;
  const existingCipherRef = sampleData.prepared?.encryption?.cipher_ref || "";
  const keyHandle = sampleData.prepared?.encryption?.key_handle || "";

  if (!to) throw new Error("Missing recipient wallet in sample.json");
  if (!uri) throw new Error("Missing metadata URI in sample.json");

  if (!rpcUrl)
    throw new Error(
      `RPC URL for target network '${network.target}' is required`,
    );
  if (!pk)
    throw new Error(
      "BACKEND_PRIVATE_KEY, PRIVATE_KEY_ETH, or PRIVATE_KEY_ETH_2 env var is required",
    );
  if (!collectionAddress)
    throw new Error("fheNftConfig.erc721mg.collectionAddress is required");
  if (!gatewayAddress)
    throw new Error("fheNftConfig.erc721mg.gatewayAddress is required");
  if (!to) throw new Error("fheNftConfig.erc721mg.mint.to is required");
  if (!uri) throw new Error("fheNftConfig.erc721mg.mint.uri is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
    batchMaxCount: 1,
  });
  const signer = new ethers.Wallet(pk, provider);

  console.log("Gateway mint-only mode");
  console.log("Signer:", signer.address);
  console.log("Gateway:", gatewayAddress);
  console.log("Collection:", collectionAddress);
  console.log("Order ID:", orderId);
  console.log("Recipient:", to);
  console.log("URI:", uri);
  console.log("Mint method:", mintMethod);
  console.log("Dry run:", dryRun);

  const collection = new ethers.Contract(
    collectionAddress,
    [
      "function minters(address) view returns (bool)",
      "function owner() view returns (address)",
    ],
    provider,
  );

  const gateway = new ethers.Contract(
    gatewayAddress,
    [
      "function allowedCollections(address) view returns (bool)",
      "function owner() view returns (address)",
      "function unsafeMint(string orderId, address collection, address to, string uri, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encKey, string cipherRef) external returns (uint256)",
      "function unsafeCheckout(address collection, address to, string uri, (uint256 ctHash,uint8 securityZone,uint8 utype,bytes signature) encKey, string cipherRef, address paymentToken, uint256 amount) external payable returns (uint256)",
    ],
    signer,
  );

  const gatewayCode = await provider.getCode(gatewayAddress);
  if (gatewayCode === "0x") {
    throw new Error(
      `No contract deployed at gateway address ${gatewayAddress}`,
    );
  }

  const collectionCode = await provider.getCode(collectionAddress);
  if (collectionCode === "0x") {
    throw new Error(
      `No contract deployed at collection address ${collectionAddress}`,
    );
  }

  const [gatewayIsMinter, collectionAllowed] = await Promise.all([
    collection.minters(gatewayAddress),
    gateway.allowedCollections(collectionAddress).catch(() => false),
  ]);

  console.log("Gateway is collection minter:", gatewayIsMinter);
  console.log("Collection allowed in gateway:", collectionAllowed);

  if (!gatewayIsMinter) {
    const collectionOwner = await collection.owner();
    throw new Error(
      [
        "Gateway is not a minter on the configured collection.",
        `Call setMinter(${gatewayAddress}, true) on ${collectionAddress} first.`,
        `Collection owner: ${collectionOwner}`,
      ].join("\n"),
    );
  }

  if (mintMethod === "unsafeCheckout" && !collectionAllowed) {
    const gatewayOwner = await gateway.owner();
    throw new Error(
      [
        "unsafeCheckout requires the collection to be allowed in the gateway.",
        `Call setCollectionAllowed(${collectionAddress}, true) on ${gatewayAddress} first.`,
        `Gateway owner: ${gatewayOwner}`,
      ].join("\n"),
    );
  }

  // Use existing encrypted data from sample.json (no new encryption)
  if (!existingCipherRef || !keyHandle) {
    throw new Error(
      "Missing cipherRef or keyHandle in sample.json - cannot do mint-only mode",
    );
  }

  console.log("Using existing encrypted data from sample.json");
  console.log("CipherRef:", existingCipherRef);
  console.log("KeyHandle:", keyHandle);

  const encKeyForContract = encKeyFromHandle(keyHandle);

  console.log("EncKey:", encKeyForContract);

  // Use actual payment amount from sample.json
  const paymentAmountAtomic =
    sampleData.prepared?.permit?.execution?.evm?.amount || "3000000000000000";
  const amount = BigInt(paymentAmountAtomic);
  console.log(
    "Payment amount (wei):",
    amount.toString(),
    "(testing without msg.value)",
  );
  console.log("Preflighting gateway mint...");

  try {
    if (mintMethod === "unsafeCheckout") {
      await gateway.unsafeCheckout.staticCall(
        collectionAddress,
        to,
        uri,
        encKeyForContract,
        existingCipherRef,
        ZERO_ADDRESS,
        amount,
        { value: amount }, // Send exact amount (no excess to refund)
      );
    } else {
      await gateway.unsafeMint.staticCall(
        orderId,
        collectionAddress,
        to,
        uri,
        encKeyForContract,
        existingCipherRef,
      );
    }
  } catch (err) {
    console.error("Full error details:", err);
    if (err instanceof Error) {
      console.error("Error message:", err.message);
      console.error("Error stack:", err.stack);
    }
    throw new Error(`Gateway mint preflight failed: ${getRevertMessage(err)}`);
  }

  if (dryRun) {
    console.log("Dry run complete; transaction was not sent.");
    return;
  }

  // No file writing needed - using existing encrypted data from sample.json
  console.log("Using existing encrypted data, no new files created");

  console.log("Calling gateway mint...");
  const tx =
    mintMethod === "unsafeCheckout"
      ? await gateway.unsafeCheckout(
          collectionAddress,
          to,
          uri,
          encKeyForContract,
          existingCipherRef,
          ZERO_ADDRESS,
          amount,
          { value: amount },
        )
      : await gateway.unsafeMint(
          orderId,
          collectionAddress,
          to,
          uri,
          encKeyForContract,
          existingCipherRef,
        );

  console.log("gateway mint tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  const erc721Iface = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ]);

  let mintedTokenId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      if (
        String(log.address).toLowerCase() !== collectionAddress.toLowerCase()
      ) {
        continue;
      }
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

  if (mintedTokenId === null) {
    console.warn(
      "Could not infer minted tokenId from logs; config/state were not updated.",
    );
    return;
  }

  console.log("Minted tokenId:", mintedTokenId.toString());
  updateConfig(mintedTokenId, existingCipherRef);
  updateState(mintedTokenId);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
