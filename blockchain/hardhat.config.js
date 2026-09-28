require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

/**
 * Networks:
 *  - hardhat   : in-process network (tests)
 *  - localhost : `npx hardhat node` — the default development chain
 *  - sepolia   : optional public testnet; requires SEPOLIA_RPC_URL and a
 *                funded PRIVATE_KEY in .env. Never commit real keys.
 */
const sepoliaAccounts =
  process.env.PRIVATE_KEY && process.env.SEPOLIA_RPC_URL ? [process.env.PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // The rich ArtifactRegistered event exceeds plain-codegen stack
      // limits; the IR pipeline compiles it cleanly.
      viaIR: true,
      // OpenZeppelin 5.4 uses `mcopy`, which requires the Cancun EVM.
      evmVersion: 'cancun',
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: process.env.RPC_URL || 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || '',
      chainId: 11155111,
      accounts: sepoliaAccounts,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};
