import fs from "node:fs";
import path from "node:path";
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

const DEFAULT_GATEWAY_ADDRESS = "0xA91D70aE85af28Efc23D5d90348a72A08C56056A";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizePrivateKey(pk: string): `0x${string}` {
  return pk.startsWith("0x")
    ? (pk as `0x${string}`)
    : (`0x${pk}` as `0x${string}`);
}

function getGatewayAddress(erc721mg: any): string {
  return (
    process.env.AUTHORITY_GATEWAY_ADDRESS ||
    process.env.ERC721MG_GATEWAY_ADDRESS ||
    erc721mg.gatewayAddress ||
    DEFAULT_GATEWAY_ADDRESS
  );
}

function getMintMethod(): "unsafeMint" | "unsafeCheckout" {
  const method = process.env.FHE_GATEWAY_MINT_METHOD || "unsafeMint";
  if (method !== "unsafeMint" && method !== "unsafeCheckout") {
    throw new Error(
      "FHE_GATEWAY_MINT_METHOD must be either 'unsafeMint' or 'unsafeCheckout'",
    );
  }
  return method;
}

async function encryptGiftcodeWithAes128(giftcode: string) {
  const aesKeyBytes = crypto.getRandomValues(new Uint8Array(16));
  const aesKeyHex = Array.from(aesKeyBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const aesKeyBigInt = BigInt("0x" + aesKeyHex);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedGiftcode = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(giftcode),
  );

  const encryptedPayload = new Uint8Array(
    iv.length + encryptedGiftcode.byteLength,
  );
  encryptedPayload.set(iv);
  encryptedPayload.set(new Uint8Array(encryptedGiftcode), iv.length);

  return { aesKeyBigInt, aesKeyHex: "0x" + aesKeyHex, encryptedPayload };
}

function updateDecryptConfig(
  mintedTokenId: bigint,
  cipherRef: string,
  giftcode: string,
  aesKeyHex: string,
) {
  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const configPath = path.join(__dirname, "..", "config.js");
  const content = fs.readFileSync(configPath, "utf8");

  const updated = content.replace(
    /decrypt:\s*\{[\s\S]*?tokenId:\s*\d+[\s\S]*?\n\s*\}/,
    `decrypt: {\n    tokenId: ${mintedTokenId},\n    cipherRef: "${cipherRef}",\n    giftcode: "${giftcode}", // For testing only\n    aesKeyHex: "${aesKeyHex}" // For testing only\n  }`,
  );

  fs.writeFileSync(configPath, updated, "utf8");
  console.log("Updated config.js decrypt block");
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
    process.env.FHE_GATEWAY_ORDER_ID ||
    `manual-${crypto.randomUUID()}`;
  const existingCipherRef = sampleData.prepared?.encryption?.cipher_ref || "";
  const keyHandle = sampleData.prepared?.encryption?.key_handle || "";

  if (!to) throw new Error("Missing recipient wallet in sample.json");
  if (!uri) throw new Error("Missing metadata URI in sample.json");

  const giftcode =
    mint.plaintextGiftcode ||
    `MOGATE_TEST_GIFTCODE_${Date.now().toString().slice(-6)}`;

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

  console.log("Gateway encrypt-mint mode (similar to 2-mint-giftcode-b.ts)");
  console.log("Signer:", signer.address);
  console.log("Gateway:", gatewayAddress);
  console.log("Collection:", collectionAddress);
  console.log("Order ID:", orderId);
  console.log("Recipient:", to);
  console.log("URI:", uri);
  console.log("Mint method:", mintMethod);
  console.log("Dry run:", dryRun);
  console.log("Giftcode (plaintext, off-chain):", giftcode);

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

  // ENCRYPT THE GIFTCODE WITH AES (similar to 2-mint-giftcode-b.ts)
  console.log("Encrypting giftcode with AES...");
  const { aesKeyBigInt, aesKeyHex, encryptedPayload } =
    await encryptGiftcodeWithAes128(giftcode);

  const cipherRef = `giftcode_${Date.now()}.bin`;
  console.log("Generated AES key (hex, testing only):", aesKeyHex);
  console.log("Giftcode (plaintext):", giftcode);

  // Set up CoFHE client for encrypting the AES key
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const account = privateKeyToAccount(normalizePrivateKey(pk));
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

  console.log("Encrypting AES key with CoFHE for gateway caller...");
  const [encKey] = await cofheClient
    .encryptInputs([Encryptable.uint128(aesKeyBigInt)])
    .setAccount(gatewayAddress)
    .execute();

  if (encKey.ctHash === undefined || !encKey.signature) {
    throw new Error("Invalid CoFHE encrypted input: missing ctHash/signature.");
  }

  const encKeyForContract: InEuint128Input = {
    ctHash: BigInt(encKey.ctHash),
    securityZone: Number(encKey.securityZone ?? 0),
    utype: Number(encKey.utype ?? 6),
    signature: String(encKey.signature ?? "0x"),
  };

  console.log("EncKey:", encKeyForContract);
  console.log("Preflighting gateway mint...");

  try {
    if (mintMethod === "unsafeCheckout") {
      const amount = BigInt(process.env.FHE_GATEWAY_PAYMENT_AMOUNT_WEI || "1");
      await gateway.unsafeCheckout.staticCall(
        collectionAddress,
        to,
        uri,
        encKeyForContract,
        cipherRef,
        ZERO_ADDRESS,
        amount,
        { value: amount },
      );
    } else {
      await gateway.unsafeMint.staticCall(
        orderId,
        collectionAddress,
        to,
        uri,
        encKeyForContract,
        cipherRef,
      );
    }
  } catch (err) {
    throw new Error(`Gateway mint preflight failed: ${getRevertMessage(err)}`);
  }

  if (dryRun) {
    console.log("Dry run complete; transaction was not sent.");
    return;
  }

  const repoRoot = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "..",
  );
  await fs.promises.writeFile(path.join(repoRoot, cipherRef), encryptedPayload);
  console.log("Encrypted giftcode saved to:", cipherRef);

  console.log("Calling gateway mint...");
  const tx =
    mintMethod === "unsafeCheckout"
      ? await gateway.unsafeCheckout(
          collectionAddress,
          to,
          uri,
          encKeyForContract,
          cipherRef,
          ZERO_ADDRESS,
          BigInt(process.env.FHE_GATEWAY_PAYMENT_AMOUNT_WEI || "1"),
          { value: BigInt(process.env.FHE_GATEWAY_PAYMENT_AMOUNT_WEI || "1") },
        )
      : await gateway.unsafeMint(
          orderId,
          collectionAddress,
          to,
          uri,
          encKeyForContract,
          cipherRef,
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
  updateDecryptConfig(mintedTokenId, cipherRef, giftcode, aesKeyHex);
  updateState(mintedTokenId);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
