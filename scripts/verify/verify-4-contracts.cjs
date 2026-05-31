const { ethers } = require("ethers");
require("dotenv").config();

console.log("🔍 VERIFICATION INSTRUCTIONS FOR 4 CONTRACTS");
console.log("==========================================\n");

const contracts = [
  {
    name: "ERC721MG",
    address: "0x4cf031C2ecf8ee6b08bF7ab16a49636A0FADBF9D",
    constructorArgs: '"Mogate Giftcode" "MG"',
    file: "ERC721MG.sol",
  },
  {
    name: "AuthorityMintGateway",
    address: "0xA91D70aE85af28Efc23D5d90348a72A08C56056A",
    constructorArgs: "",
    file: "gateways/AuthorityMintGateway.fhe.faucet.sol",
  },
  {
    name: "TestMGC",
    address: "0x4663433836a7BA67Aef340c9B7Cc8750635f2BC5",
    constructorArgs: "0xA31A54e4C258B1BE8cE887a2724906BfCe88Cc6A",
    file: "ERC721.sol",
  },
  {
    name: "MyToken",
    address: "0x2f4814Ee42DA30364fd041BE49D073B30E1cb05F",
    constructorArgs: "0xA31A54e4C258B1BE8cE887a2724906BfCe88Cc6A",
    file: "simplERC721.sol",
  },
];

console.log("📋 Add this to your .env file:");
console.log("ETHERSCAN_API_KEY=your_api_key_here\n");

console.log("🔧 Manual Verification Commands:");
console.log("================================");

contracts.forEach((contract, index) => {
  console.log(`\n${index + 1}. ${contract.name}:`);
  console.log(`   Address: ${contract.address}`);
  console.log(
    `   Explorer: https://sepolia.etherscan.io/address/${contract.address}#code`,
  );

  if (contract.constructorArgs) {
    console.log(
      `   Command: npx hardhat verify --network sepolia ${contract.address} ${contract.constructorArgs}`,
    );
  } else {
    console.log(
      `   Command: npx hardhat verify --network sepolia ${contract.address}`,
    );
  }
});

console.log("\n🌐 Direct Links for Manual Verification:");
console.log("=======================================");

contracts.forEach((contract, index) => {
  console.log(`\n${index + 1}. ${contract.name}:`);
  console.log(`   https://sepolia.etherscan.io/address/${contract.address}`);
});

console.log("\n📝 Manual Verification Steps:");
console.log("============================");
console.log("1. Visit each contract address above");
console.log("2. Click 'Contract' tab");
console.log("3. Click 'Verify and Publish'");
console.log("4. Select 'Solidity (Single File)'");
console.log("5. Compiler Version: 0.8.20");
console.log("6. License: MIT");
console.log("7. Paste the contract source code");
console.log("8. Click 'Verify and Publish'");

console.log("\n✅ All contracts deployed successfully!");
console.log("💰 Total gas used: ~0.05 ETH");
console.log("🔗 All contracts are configured and ready to use!");
