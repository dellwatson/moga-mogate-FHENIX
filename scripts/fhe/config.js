import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Load dotenv from project root
const __dirname = path.dirname(new URL(import.meta.url).pathname);
loadEnv({ path: path.join(__dirname, "..", "..", ".env") });
const statePath = path.join(__dirname, "erc721mg_state.json");

let lastTokenId = 0n;

try {
  const raw = fs.readFileSync(statePath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.lastTokenId !== undefined) {
    lastTokenId = BigInt(parsed.lastTokenId);
  }
} catch {
  // If state file doesn't exist or is invalid, keep default 0n
}

export const fheNftConfig = {
  network: {
    target: process.env.TARGET_NETWORK || "sepolia",
    rpcUrls: {
      polygonAmoy: process.env.POLYGON_AMOY_RPC_URL,
      arbitrumSepolia: process.env.ARBITRUM_SEPOLIA_RPC_URL,
      polkadotTestnet: process.env.POLKADOT_TESTNET_RPC_URL,
      // sepolia: process.env.SEPOLIA_RPC_URL,
      sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
      // sepolia: "https://ethereum-sepolia-rpc.publicnode.com",
      // sepolia: "https://rpc.sepolia.ethpandaops.io",
    },
    // privateKey:
    //   "a9d27031d50729345639276dbc8e0708215fc888955272ea0d9fae78d5223bf8",
    privateKey: process.env.PRIVATE_KEY_ETH || process.env.PRIVATE_KEY_ETH_2,
    privateKey2: process.env.PRIVATE_KEY_ETH_2,
    backendPrivateKey:
      process.env.BACKEND_PRIVATE_KEY || process.env.PRIVATE_KEY_ETH,
  },
  deploy: {
    name: process.env.ERC721MG_NAME || "Mogate Giftcode",
    symbol: process.env.ERC721MG_SYMBOL || "MGC",
  },
  erc721mg: {
    collectionAddress: "0xFBf8608D465D4Aa88b7fDb4Bb76c84cb7037AE55", // old not used anymore overall
    latestCollectionAddress: "0x4cf031C2ecf8ee6b08bF7ab16a49636A0FADBF9D",
    gatewayAddress: "0x0E6aE325c227355219F31D37039C1bf0BfF0d8a5",
    FHE_gatewayAddress: "0x0E6aE325c227355219F31D37039C1bf0BfF0d8a5",
    mint: {
      // to: "0x72776B37a55d502E81C29103b89e84EcC81BD63d",
      to: "0xA31A54e4C258B1BE8cE887a2724906BfCe88Cc6A",
      uri: "https://metadata.mogate.xyz/erc721mg/test.json",
      plaintextGiftcode: "other-acc-new-est-test-new-giftcode-uuid-123",
    },
    decrypt: {
    tokenId: 28,
    cipherRef: "http://127.0.0.1:9800/d3kd1qvkoudjtibpmo20/giftcard-ciphertext/giftcode_1779446478909_b9ca8f8d-cd3f-440f-a462-ca73a7cc2274.ciphertext",
    giftcode: "other-acc-new-est-test-new-giftcode-uuid-123", // For testing only
    aesKeyHex: "0x5fa2bec145327b5398fb9a4079d55c65" // For testing only
  },
  },
  vault: {
    address: process.env.VAULT_ADDRESS,
    executor: {
      address: process.env.EXECUTOR_ADDRESS,
      allowed:
        (process.env.EXECUTOR_ALLOWED || "true").toLowerCase() !== "false",
    },
  },
};
