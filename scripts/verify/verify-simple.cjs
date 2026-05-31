console.log("🔍 MANUAL VERIFICATION INSTRUCTIONS");
console.log("====================================\n");

console.log("✅ Successfully Submitted:");
console.log(
  "1. ERC721MG: https://sepolia.etherscan.io/address/0x4cf031C2ecf8ee6b08bF7ab16a49636A0FADBF9D#code",
);
console.log(
  "2. AuthorityMintGateway: https://sepolia.etherscan.io/address/0xA91D70aE85af28Efc23D5d90348a72A08C56056A#code",
);

console.log("\n📝 Need Manual Verification:");
console.log(
  "3. TestMGC: https://sepolia.etherscan.io/address/0x4663433836a7BA67Aef340c9B7Cc8750635f2BC5",
);
console.log(
  "4. MyToken: https://sepolia.etherscan.io/address/0x2f4814Ee42DA30364fd041BE49D073B30E1cb05F",
);

console.log("\n🔧 Manual Steps:");
console.log("1. Visit each contract address");
console.log("2. Click 'Contract' tab");
console.log("3. Click 'Verify and Publish'");
console.log("4. Select: Solidity (Single File)");
console.log("5. Compiler Version: 0.8.20");
console.log("6. Optimization: Enabled (200 runs)");
console.log("7. License: MIT");
console.log("8. Paste source code from:");
console.log("   - TestMGC: contracts/ERC721.sol");
console.log("   - MyToken: contracts/simplERC721.sol");
console.log("9. Constructor Args:");
console.log(
  "   - TestMGC: 000000000000000000000000a31a54e4c258b1be8ce887a2724906bfce88cc6a",
);
console.log(
  "   - MyToken: 000000000000000000000000a31a54e4c258b1be8ce887a2724906bfce88cc6a",
);

console.log("\n🎉 All contracts deployed and configured!");
console.log("💰 Gas used: ~0.05 ETH");
console.log("🔗 Gateway is set as minter for ERC721MG");
