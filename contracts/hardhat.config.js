require("@nomicfoundation/hardhat-toolbox");

// Standard Hardhat local test mnemonic (well-known, NOT for production).
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

// Optional: override signing accounts via env.
// PRIVATE_KEYS="0xkey1,0xkey2,..." — comma-separated hex private keys.
function accountsFromEnv() {
  if (process.env.PRIVATE_KEYS) {
    return process.env.PRIVATE_KEYS.split(",").map((k) => k.trim()).filter(Boolean);
  }
  if (process.env.MNEMONIC) {
    return { mnemonic: process.env.MNEMONIC, count: 10, path: "m/44'/60'/0'/0/", initialIndex: 0 };
  }
  return { mnemonic: TEST_MNEMONIC, count: 10, path: "m/44'/60'/0'/0/", initialIndex: 0 };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: accountsFromEnv(),
    },
  },
  gasReporter: { enabled: false },
};
