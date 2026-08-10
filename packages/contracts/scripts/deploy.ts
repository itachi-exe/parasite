/**
 * Deploy ParasiteGame to Base Sepolia (or a local Hardhat node).
 *
 * TODO(ASHE): No DEPLOYER_PRIVATE_KEY was provided with this build, so no
 * deployment was performed and NEXT_PUBLIC_PARASITE_GAME_ADDRESS is empty. To
 * finish the deployment you need:
 *
 *   1. A Base Sepolia account funded with testnet ETH
 *      (faucet: https://www.alchemy.com/faucets/base-sepolia)
 *   2. That account's private key in .env as DEPLOYER_PRIVATE_KEY
 *   3. Optionally a non-rate-limited RPC in NEXT_PUBLIC_BASE_SEPOLIA_RPC
 *
 * Then run, from the repo root:
 *
 *   npm run deploy:baseSepolia
 *
 * Copy the printed address into .env as NEXT_PUBLIC_PARASITE_GAME_ADDRESS and
 * restart the web app. The app switches from SIMULATED to INCO mode on its own
 * once that variable is set — no code change required.
 */

import { ethers, network } from 'hardhat';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const INCO_TESTNET_SINGLETON = '0xe9CB49A5b16C6D4a093E5900AA8b450FD40541B6';

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log(`\n── Deploying ParasiteGame ──────────────────────────────────`);
  console.log(`network:  ${network.name} (chainId ${net.chainId})`);

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    console.error(
      `\n✗ No signer available.\n` +
        `  TODO(ASHE): set DEPLOYER_PRIVATE_KEY in .env (repo root) to a funded\n` +
        `  Base Sepolia account, then re-run:  npm run deploy:baseSepolia\n`
    );
    process.exit(1);
  }

  const deployer = signers[0];
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer: ${deployer.address}`);
  console.log(`balance:  ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error(
      `\n✗ Deployer has no ETH. Fund it from a Base Sepolia faucet:\n` +
        `  https://www.alchemy.com/faucets/base-sepolia\n`
    );
    process.exit(1);
  }

  // Sanity check: the contract imports Lib.testnet.sol, which hardcodes the
  // IncoLightning singleton. If nothing is deployed there, every FHE call will
  // revert at runtime — better to fail loudly here than to ship a dead contract.
  // Only meaningful against the real network: a local Hardhat node has no Inco
  // deployment at all (tests inject a mock there instead).
  const isRealBaseSepolia = network.name === 'baseSepolia';
  if (isRealBaseSepolia) {
    const code = await ethers.provider.getCode(INCO_TESTNET_SINGLETON);
    if (code === '0x') {
      console.error(
        `\n✗ No contract found at the Inco Lightning testnet singleton\n` +
          `  ${INCO_TESTNET_SINGLETON}\n` +
          `  ParasiteGame imports Lib.testnet.sol and will revert on every FHE op.\n` +
          `  Check that this RPC really points at Base Sepolia, and that Inco has\n` +
          `  not redeployed. See docs/inco.md §1.\n`
      );
      process.exit(1);
    }
    console.log(`inco:     ${INCO_TESTNET_SINGLETON} ✓ (code present)`);
  } else {
    console.log(
      `inco:     skipped check (network "${network.name}" is not baseSepolia)\n` +
        `          NOTE: FHE ops will revert here — local runs use the mock in tests.`
    );
  }

  const Factory = await ethers.getContractFactory('ParasiteGame');
  const game = await Factory.deploy();
  console.log(`\ndeploying… tx ${game.deploymentTransaction()?.hash}`);
  await game.waitForDeployment();

  const address = await game.getAddress();
  console.log(`\n✓ ParasiteGame deployed to ${address}`);

  // Pre-fund so the contract can pay Inco fees on behalf of players if a client
  // ever underpays. Small, and skipped on a local node.
  if (isRealBaseSepolia && balance > ethers.parseEther('0.005')) {
    const tx = await deployer.sendTransaction({
      to: address,
      value: ethers.parseEther('0.001'),
    });
    await tx.wait();
    console.log(`✓ pre-funded with 0.001 ETH for FHE fees`);
  }

  const outDir = path.resolve(__dirname, '../deployments');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const record = {
    network: network.name,
    chainId: Number(net.chainId),
    address,
    deployer: deployer.address,
    incoSingleton: INCO_TESTNET_SINGLETON,
    deployedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(outDir, `${network.name}.json`),
    JSON.stringify(record, null, 2)
  );

  console.log(`\n── Next step ───────────────────────────────────────────────`);
  console.log(`Add to .env in the repo root:\n`);
  console.log(`  NEXT_PUBLIC_PARASITE_GAME_ADDRESS=${address}\n`);
  console.log(`Then restart the web app. It will switch from SIMULATED to INCO`);
  console.log(`role mode automatically.\n`);

  if (process.env.BASESCAN_API_KEY) {
    console.log(`Verify with:`);
    console.log(`  npx hardhat verify --network baseSepolia ${address}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
