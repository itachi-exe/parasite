import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import path from 'node:path';

// Load the repo-root .env so contracts and app share one config file.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? '';
const BASE_SEPOLIA_RPC =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org';

const config: HardhatUserConfig = {
  solidity: {
    // Must be >= 0.8.29: @inco/lightning/src/IncoLightning.sol declares
    // `pragma solidity ^0.8.29`, and it is pulled in transitively by Lib.*.sol.
    version: '0.8.30',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // The Inco library is large; via-IR keeps stack depth manageable.
      viaIR: true,
      // Required: Inco's BaseAccessControlList uses tload/tstore (EIP-1153) for
      // transient access grants, which only exist on Cancun-capable VMs.
      // Base Sepolia is post-Cancun, so this matches the deploy target.
      evmVersion: 'cancun',
    },
  },
  networks: {
    hardhat: {
      // Chain id mirrors Base Sepolia so client code paths behave the same
      // against a local node.
      chainId: 84532,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC,
      chainId: 84532,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
