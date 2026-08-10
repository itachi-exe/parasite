// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Inco Lightning library re-export — network selection lives HERE and nowhere else.
 *
 * ⚠️ READ THIS BEFORE CHANGING THE IMPORT ⚠️
 *
 * `@inco/lightning/src/Lib.sol` (the default) hardcodes
 *     inco = 0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624
 * which is the **mainnet** IncoLightning singleton — byte-identical to
 * `Lib.mainnet.sol`. The docs do not flag this.
 *
 * Deploying a contract that imports the default `Lib.sol` to Base Sepolia
 * produces something that compiles cleanly, deploys cleanly, and then reverts
 * on the very first FHE operation, because nothing lives at the mainnet address
 * on Base Sepolia. That failure looks like a bug in your game, not a bad import.
 *
 * Address map (verified against @inco/lightning@1.0.2 sources):
 *   Lib.sol / Lib.mainnet.sol → 0x4b9911b0191B0b6a6eA8F2Ed562e20Cff5AC8624  (Base mainnet)
 *   Lib.testnet.sol           → 0xe9CB49A5b16C6D4a093E5900AA8b450FD40541B6  (Base Sepolia)  ← we use this
 *   Lib.devnet.sol            → 0xB3C06f0Ed967a7E366ba31C67927DDf93d7c1154
 *   Lib.demonet.sol           → 0xad9Af2e804FbF14d69391167F1FCDf918A3980fb
 *   Lib.alphanet.sol          → 0xc0d693DeEF0A91CE39208676b6da09B822abd199
 *
 * To ship on Base mainnet, change the one line below to `Lib.mainnet.sol`.
 */
import {euint256, ebool, eaddress, e, inco} from "@inco/lightning/src/Lib.testnet.sol";
