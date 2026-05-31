import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

async function main() {
  const network = process.env.TARGET_NETWORK || "sepolia";
  const address = process.env.CONTRACT_ADDRESS;
  const apiKey = process.env.ETHERSCAN_API_KEY;

  if (!address) throw new Error("CONTRACT_ADDRESS env var is required");
  if (!apiKey) throw new Error("ETHERSCAN_API_KEY env var is required");

  const chainIds: Record<string, string> = {
    polygonAmoy: "80002",
    arbitrumSepolia: "421614",
    sepolia: "11155111",
    polkadotTestnet: "420420417",
  };

  const chainId = chainIds[network];
  if (!chainId) throw new Error(`Unsupported network: ${network}`);

  const apiUrls: Record<string, string> = {
    polygonAmoy: "https://api-amoy.polygonscan.com/api",
    arbitrumSepolia: "https://api-sepolia.arbiscan.io/api",
    sepolia: "https://api.etherscan.io/v2/api?chainid=11155111",
    polkadotTestnet:
      "https://api.routescan.io/v2/network/testnet/evm/420420417/etherscan",
  };

  const apiUrl = apiUrls[network];
  if (!apiUrl) throw new Error(`Unsupported network: ${network}`);

  console.log(`Verifying AuthorityMintGateway at ${address} on ${network}...`);

  const repoRoot = path.resolve(__dirname, "../..");

  // Read contract source
  const contractPath = path.join(
    repoRoot,
    "contracts/gateways/AuthorityMintGateway.fhe.faucet.sol",
  );
  const contractSource = fs.readFileSync(contractPath, "utf8");

  // Helper to read all files in a directory recursively
  function readAllFiles(
    dir: string,
    base: string = "",
  ): Record<string, { content: string }> {
    const files: Record<string, { content: string }> = {};
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relativePath = path.join(base, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        Object.assign(files, readAllFiles(fullPath, relativePath));
      } else if (item.endsWith(".sol")) {
        files[relativePath] = { content: fs.readFileSync(fullPath, "utf8") };
      }
    }

    return files;
  }

  // Read all OpenZeppelin contracts
  const openzeppelinPath = path.join(
    repoRoot,
    "node_modules",
    "@openzeppelin",
    "contracts",
  );
  const openzeppelinSources = readAllFiles(
    openzeppelinPath,
    "@openzeppelin/contracts",
  );

  // Read all FHE contracts
  const fhePath = path.join(
    repoRoot,
    "node_modules",
    "@fhenixprotocol",
    "cofhe-contracts",
  );
  const fheSources = readAllFiles(fhePath, "@fhenixprotocol/cofhe-contracts");

  // Prepare standard JSON input for verification
  const sourceCode = JSON.stringify({
    language: "Solidity",
    sources: {
      "contracts/gateways/AuthorityMintGateway.fhe.faucet.sol": {
        content: contractSource,
      },
      ...openzeppelinSources,
      ...fheSources,
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: {
        "*": {
          "*": ["evm.bytecode", "evm.deployedBytecode", "abi"],
        },
      },
    },
  });

  const params = new URLSearchParams({
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: sourceCode,
    codeformat: "solidity-standard-json-input",
    contractname:
      "contracts/gateways/AuthorityMintGateway.fhe.faucet.sol:AuthorityMintGateway",
    compilerversion: "v0.8.27+commit.40a35a09",
    constructorArguements: "", // No constructor args
  });

  console.log("Submitting verification request...");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const responseText = await response.text();
  console.log("Raw response:", responseText);
  const result = JSON.parse(responseText);
  console.log("Verification submitted:", result);

  const explorerUrls: Record<string, string> = {
    polygonAmoy: "https://amoy.polygonscan.com",
    arbitrumSepolia: "https://sepolia.arbiscan.io",
    sepolia: "https://sepolia.etherscan.io",
    polkadotTestnet: "https://testnet-explorer.polkadot.io",
  };

  const explorerUrl = explorerUrls[network];

  if (result.status === "1") {
    console.log(`✅ Verification GUID: ${result.result}`);
    console.log(`\nChecking verification status...`);

    // Wait a bit then check status
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const statusParams = new URLSearchParams({
      apikey: apiKey,
      module: "contract",
      action: "checkverifystatus",
      guid: result.result,
    });

    const statusUrl =
      network === "polkadotTestnet"
        ? "https://api.routescan.io/v2/network/testnet/evm/420420417/etherscan"
        : network === "sepolia"
        ? "https://api.etherscan.io/v2/api?chainid=11155111"
        : `https://api.etherscan.io/v2/api?chainid=${chainId}`;
    const statusResponse = await fetch(
      `${statusUrl}&${statusParams.toString()}`,
    );
    const statusText = await statusResponse.text();
    console.log("Status response:", statusText);

    const statusResult = JSON.parse(statusText);

    if (statusResult.status === "1") {
      console.log("✅ Contract verified successfully!");
      console.log(`View at: ${explorerUrl}/address/${address}#code`);
    } else if (String(statusResult.result || "").startsWith("Fail -")) {
      console.log(`❌ Verification failed: ${statusResult.result}`);
      console.log(`Check details at: ${explorerUrl}/address/${address}#code`);
      process.exitCode = 1;
    } else {
      console.log(`⏳ Verification pending: ${statusResult.result}`);
      console.log(`Check status at: ${explorerUrl}/address/${address}#code`);
    }
  } else {
    console.log("❌ Verification failed:", result.result);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
