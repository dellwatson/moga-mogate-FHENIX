import { ethers } from "ethers";
import { createRaffleClient, PrizeTokenType } from "../../ts-sdk/src/evm/index.ts";

async function main() {
  const target = process.env.TARGET_NETWORK || "sepolia";

  let rpcUrl: string | undefined;
  let raffleAddress: string | undefined;
  let collectionAddress: string | undefined;

  if (target === "polygonAmoy") {
    rpcUrl = process.env.POLYGON_AMOY_RPC_URL;
    raffleAddress = "0x981a93Ba85CA910BeB8B093CC3677e195d2A1984";
    collectionAddress = process.env.COLLECTION_ADDRESS_POLYGON_AMOY;
  } else if (target === "arbitrumSepolia") {
    rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
    raffleAddress = "0x9D2067BeB1c165FDE0F89E40Bd97f3276C153385";
    collectionAddress = process.env.COLLECTION_ADDRESS_ARBITRUM_SEPOLIA;
  } else {
    throw new Error("Unsupported TARGET_NETWORK for this test script");
  }

  const pk =
    process.env.PRIVATE_KEY_ETH ||
    process.env.SEPOLIA_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_ETH_2;

  if (!rpcUrl)
    throw new Error("RPC URL env var is required for target network");
  if (!pk)
    throw new Error(
      "PRIVATE_KEY_ETH / PRIVATE_KEY_ETH_2 or SEPOLIA_PRIVATE_KEY env var is required",
    );
  if (!raffleAddress)
    throw new Error("RAFFLE_ADDRESS env var for target network is required");

  const client = createRaffleClient({
    rpcUrl,
    privateKey: pk,
    raffleAddress,
  });

  const { raffle, signer } = client;
  if (!signer) throw new Error("Signer missing for test flow");

  console.log("Using network:", target);
  console.log("Deployer:", await signer.getAddress());
  console.log("Raffle contract:", raffleAddress);

  const raffleId = `test-${Date.now()}`;
  const totalSlots = 5n;
  const maxSlotsPerAddress = 5n;
  const metadataUri = "https://example.com/raffle-metadata.json";
  const collection =
    collectionAddress && collectionAddress !== ""
      ? collectionAddress
      : ethers.ZeroAddress;
  const premintContract = false;
  const premint = false;
  // Prize config: simple 1x ERC721 for now.
  const prizeType = PrizeTokenType.ERC721;
  const prizeAmount = 1n;
  const autoClaim = collection !== ethers.ZeroAddress;
  const autoDraw = !autoClaim;
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("Creating raffle with id:", raffleId);

  const hostTx = await raffle.unsafeHostRaffle(
    raffleId,
    totalSlots,
    maxSlotsPerAddress,
    metadataUri,
    collection,
    premintContract,
    premint,
    prizeType,
    prizeAmount,
    autoDraw,
    autoClaim,
    expiresAt,
  );
  const hostRc = await hostTx.wait();
  console.log("Hosted raffle. Tx:", hostRc?.hash);

  const slotIds = [1n, 2n, 3n, 4n, 5n];
  const amount = ethers.parseEther("0.01");

  console.log(
    "Joining raffle with slots",
    slotIds,
    "amount",
    amount.toString(),
  );

  const joinTx = await raffle.unsafeJoinRaffle(
    raffleId,
    slotIds,
    amount,
    ethers.ZeroAddress,
    { value: amount },
  );
  const joinRc = await joinTx.wait();
  console.log("Joined raffle. Tx:", joinRc?.hash);

  const load = await raffle.getRaffleLoadDetail(raffleId);
  console.log("Raffle load:", {
    totalSlots: load[0].toString(),
    soldSlots: load[1].toString(),
    status: load[11],
  });

  const [winnerSlot, winner, statusAfter] = await raffle.getRaffleResult(
    raffleId,
  );
  console.log("Result:", {
    winnerSlot: winnerSlot.toString(),
    winner,
    status: statusAfter,
  });

  if (winner.toLowerCase() === (await signer.getAddress()).toLowerCase()) {
    console.log("Deployer is the winner.");
    if (autoClaim) {
      console.log(
        "autoClaim=true, prize NFT should have been minted by collection:",
        collection,
      );
    } else {
      console.log(
        "autoClaim=false. You can later enable claim logic once collection is wired.",
      );
    }
  } else {
    console.log(
      "Winner is a different address (unexpected in this simple test).",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
