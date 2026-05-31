const fs = require("fs");
const path = require("path");
const https = require("https");
const { ethers } = require("ethers");

const API_KEY = "W7471V7ER5U4253JW4B27N2H7TBSRFIBHX";
const NETWORK = "sepolia";
const CHAIN_ID = "11155111";

// Encode constructor arguments
const erc721mgArgs = ethers.AbiCoder.defaultAbiCoder()
  .encode(["string", "string"], ["Mogate Giftcode", "MG"])
  .slice(2);
const testMGCArgs = ethers.AbiCoder.defaultAbiCoder()
  .encode(["address"], ["0xA31A54e4C258B1BE8cE887a2724906BfCe88Cc6A"])
  .slice(2);
const myTokenArgs = ethers.AbiCoder.defaultAbiCoder()
  .encode(["address"], ["0xA31A54e4C258B1BE8cE887a2724906BfCe88Cc6A"])
  .slice(2);

const contracts = [
  {
    name: "ERC721MG",
    address: "0x4cf031C2ecf8ee6b08bF7ab16a49636A0FADBF9D",
    constructorArgs: erc721mgArgs,
    sourcePath: "contracts/ERC721MG.sol",
    contractName: "contracts/ERC721MG.sol:ERC721MG",
  },
  {
    name: "AuthorityMintGateway",
    address: "0xA91D70aE85af28Efc23D5d90348a72A08C56056A",
    constructorArgs: "",
    sourcePath: "contracts/gateways/AuthorityMintGateway.fhe.faucet.sol",
    contractName:
      "contracts/gateways/AuthorityMintGateway.fhe.faucet.sol:AuthorityMintGateway",
  },
  {
    name: "TestMGC",
    address: "0x4663433836a7BA67Aef340c9B7Cc8750635f2BC5",
    constructorArgs: testMGCArgs,
    sourcePath: "contracts/ERC721.sol",
    contractName: "contracts/ERC721.sol:TestMGC",
  },
  {
    name: "MyToken",
    address: "0x2f4814Ee42DA30364fd041BE49D073B30E1cb05F",
    constructorArgs: myTokenArgs,
    sourcePath: "contracts/simplERC721.sol",
    contractName: "contracts/simplERC721.sol:MyToken",
  },
];

function verifyContract(contract) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔍 Verifying ${contract.name}...`);

    // Read contract source
    const sourcePath = path.join(__dirname, "..", "..", contract.sourcePath);
    const sourceCode = fs.readFileSync(sourcePath, "utf8");

    // Prepare form data
    const postData = new URLSearchParams({
      apikey: API_KEY,
      module: "contract",
      action: "verifysourcecode",
      contractaddress: contract.address,
      sourceCode: sourceCode,
      codeformat: "solidity-single-file",
      contractname: contract.contractName.split(":")[1],
      compilerversion: "v0.8.20+commit.a1b79de6",
      optimizationUsed: 1,
      runs: 200,
      constructorArguements: contract.constructorArgs,
    });

    const options = {
      hostname: "api.etherscan.io",
      path: `/v2/api?chainid=${CHAIN_ID}`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData.toString()),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          console.log(`📤 Response:`, result);

          if (result.status === "1") {
            console.log(
              `✅ ${contract.name} verification submitted! GUID: ${result.result}`,
            );
            console.log(
              `🔗 Check: https://sepolia.etherscan.io/address/${contract.address}#code`,
            );
            resolve(result);
          } else {
            console.log(
              `❌ ${contract.name} verification failed:`,
              result.result,
            );
            reject(new Error(result.result));
          }
        } catch (e) {
          console.error(`❌ Error parsing response for ${contract.name}:`, e);
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(postData.toString());
    req.end();
  });
}

async function main() {
  console.log("🚀 Starting verification of 4 contracts...");

  for (const contract of contracts) {
    try {
      await verifyContract(contract);
      console.log(`⏳ Waiting 3 seconds before next verification...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(`❌ Failed to verify ${contract.name}:`, error.message);
    }
  }

  console.log("\n✨ Verification process completed!");
  console.log("\n📋 Summary:");
  contracts.forEach((contract) => {
    console.log(
      `🔗 ${contract.name}: https://sepolia.etherscan.io/address/${contract.address}#code`,
    );
  });
}

main().catch(console.error);
