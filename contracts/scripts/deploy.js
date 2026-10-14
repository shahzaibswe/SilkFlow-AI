// Deploys MockStableCoin + SilkEscrow to the target network and writes the
// backend consumption artifact at contracts/deployments/latest.json.
//
// Usage:
//   npx hardhat run scripts/deploy.js --network localhost
//   HARDHAT_NETWORK=localhost npx hardhat run scripts/deploy.js
//
// Local testnet ONLY: private keys are the well-known Hardhat account keys.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const DERIVATION_PATH = "m/44'/60'/0'/0/"; // account #i => path .../0/i

const AMOUNT_PER_BUYER = 1_000_000n * 1_000_000n; // 1,000,000 sUSD (6 decimals)

function walletAt(index) {
  return hre.ethers.HDNodeWallet.fromPhrase(TEST_MNEMONIC, `${DERIVATION_PATH}${index}`);
}

async function main() {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  // Role mapping (0-based Hardhat accounts): agent = #2, reviewer = #3,
  // test buyers = #4..#7 (per API_SPEC latest.json contract).
  const agent = signers[2] || walletAt(2);
  const reviewer = signers[3] || walletAt(3);
  const buyerIndexes = [4, 5, 6, 7];

  console.log(`Network: ${hre.network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  // --- MockStableCoin -------------------------------------------------------
  const Token = await ethers.getContractFactory("MockStableCoin");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`MockStableCoin (sUSD): ${tokenAddress}`);

  // --- SilkEscrow -----------------------------------------------------------
  const Escrow = await ethers.getContractFactory("SilkEscrow");
  const escrow = await Escrow.deploy(tokenAddress, agent.address, reviewer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`SilkEscrow: ${escrowAddress}`);
  console.log(`  agent:    ${agent.address}`);
  console.log(`  reviewer: ${reviewer.address}`);

  // --- Mint 1,000,000 sUSD to each test buyer (#4..#7) -----------------------
  for (const i of buyerIndexes) {
    const w = signers[i] || walletAt(i);
    const balBefore = await token.balanceOf(w.address);
    if (balBefore === 0n) {
      const mintTx = await token.mint(w.address, AMOUNT_PER_BUYER);
      await mintTx.wait();
      console.log(`Minted 1,000,000 sUSD to buyer #${i}: ${w.address}`);
    } else {
      console.log(`Buyer #${i} ${w.address} already has ${balBefore}; skipping mint`);
    }
  }

  // --- Write deployments/latest.json -----------------------------------------
  function loadAbi(name) {
    const artifactPath = path.join(
      hre.config.paths.root,
      "artifacts/contracts",
      `${name}.sol`,
      `${name}.json`
    );
    return JSON.parse(fs.readFileSync(artifactPath, "utf8")).abi;
  }

  const rpcUrl =
    hre.network.config.url ||
    (hre.network.name === "hardhat" ? "http://127.0.0.1:8545" : undefined) ||
    "http://127.0.0.1:8545";

  // Private keys: the well-known Hardhat test keys (LOCAL TESTNET ONLY — intentional for the demo).
  const buyerWallets = buyerIndexes.map((i) =>
    signers[i] && signers[i].privateKey ? signers[i] : walletAt(i)
  );
  const agentKey =
    signers[2] && signers[2].privateKey ? signers[2].privateKey : walletAt(2).privateKey;

  const artifact = {
    network: "local",
    rpcUrl,
    tokenAddress,
    escrowAddress,
    agentAddress: agent.address,
    reviewerAddress: reviewer.address,
    agentPrivateKey: agentKey,
    buyerPrivateKeys: buyerWallets.map(
      (w) => w.privateKey || walletAt(buyerWallets.indexOf(w)).privateKey
    ),
    abis: {
      SilkEscrow: loadAbi("SilkEscrow"),
      MockStableCoin: loadAbi("MockStableCoin"),
    },
  };

  const outDir = path.join(hre.config.paths.root, "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest.json");
  fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log(`Wrote ${outFile}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
