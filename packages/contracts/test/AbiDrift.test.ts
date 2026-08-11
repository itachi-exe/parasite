import { expect } from 'chai';
import { artifacts } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The web client ships a HAND-WRITTEN ABI (packages/web/src/lib/contract.ts) so
 * that the Next build has no build-order dependency on the Hardhat artifacts.
 *
 * That is a deliberate trade (see DECISIONS.md) but it buys a failure mode: a
 * Solidity signature change compiles green, the contract tests stay green, the
 * web typecheck stays green, and the dapp only breaks at runtime on a live
 * network — with an opaque revert, on the one code path we cannot cover with an
 * automated end-to-end test because no deploy key was provided.
 *
 * This test closes that gap by diffing the two. It only asserts over the subset
 * the client actually declares: the contract is free to expose extra functions
 * the UI does not call, but every entry the client DOES declare must match the
 * compiled artifact exactly — name, input types, outputs, and mutability.
 */

interface AbiEntry {
  type: string;
  name?: string;
  stateMutability?: string;
  inputs?: { name?: string; type: string }[];
  outputs?: { name?: string; type: string }[];
}

/**
 * Read the client ABI out of the .ts source.
 *
 * The contracts package cannot `import` from the web package: it is a separate
 * workspace with its own tsconfig, and pulling in a 'use client' module graph
 * under Mocha would not resolve. Extracting the array literal and evaluating
 * just that expression keeps this test dependency-free and means it reads the
 * SAME bytes the Next bundler does — not a copy that could itself drift.
 */
function loadClientAbi(): AbiEntry[] {
  const src = fs.readFileSync(
    path.join(__dirname, '../../web/src/lib/contract.ts'),
    'utf8'
  );
  const start = src.indexOf('export const PARASITE_GAME_ABI = [');
  expect(start, 'PARASITE_GAME_ABI not found in the web client').to.be.greaterThan(-1);

  const open = src.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, 'could not find the end of the ABI literal').to.be.greaterThan(-1);

  // The literal is pure JSON-compatible data (no expressions), so evaluating it
  // in isolation is safe and avoids depending on a TS transpiler here.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return ${src.slice(open, end + 1)};`)() as AbiEntry[];
}

/** Canonical form for comparison: parameter NAMES are cosmetic, types are not. */
const shape = (e: AbiEntry) =>
  JSON.stringify({
    type: e.type,
    name: e.name,
    stateMutability: e.stateMutability,
    inputs: (e.inputs ?? []).map((i) => i.type),
    outputs: (e.outputs ?? []).map((o) => o.type),
  });

describe('web client ABI ↔ compiled artifact', () => {
  let onChain: AbiEntry[];
  let client: AbiEntry[];

  before(async () => {
    onChain = (await artifacts.readArtifact('ParasiteGame')).abi as AbiEntry[];
    client = loadClientAbi();
  });

  it('declares a non-trivial ABI (guards against a broken extraction)', () => {
    expect(client.length).to.be.greaterThan(5);
    expect(client.some((e) => e.type === 'function' && e.name === 'jump')).to.equal(true);
  });

  it('every function the client declares exists on-chain with the same signature', () => {
    const actual = new Map(
      onChain.filter((e) => e.type === 'function').map((e) => [e.name!, e])
    );

    for (const fn of client.filter((e) => e.type === 'function')) {
      const real = actual.get(fn.name!);
      expect(real, `client calls ${fn.name}() but the contract has no such function`).to
        .not.be.undefined;

      // Events carry no stateMutability; functions must agree on it, because a
      // payable→nonpayable change makes every client call revert on value.
      expect(shape(fn), `signature drift on ${fn.name}()`).to.equal(shape(real!));
    }
  });

  it('every event the client decodes matches the emitted signature', () => {
    const actual = new Map(
      onChain.filter((e) => e.type === 'event').map((e) => [e.name!, e])
    );

    for (const ev of client.filter((e) => e.type === 'event')) {
      const real = actual.get(ev.name!);
      expect(real, `client listens for ${ev.name} but the contract never emits it`).to.not
        .be.undefined;
      expect(shape(ev), `event drift on ${ev.name}`).to.equal(shape(real!));
      // Indexed-ness is part of the wire format for logs, not part of `shape`.
      const clientIdx = (ev.inputs ?? []).map((i) => (i as { indexed?: boolean }).indexed ?? false);
      const realIdx = (real!.inputs ?? []).map((i) => (i as { indexed?: boolean }).indexed ?? false);
      expect(clientIdx, `indexed-flag drift on ${ev.name}`).to.deep.equal(realIdx);
    }
  });

  it('the payable calls the client sends value with are actually payable', () => {
    // These are the three the UI funds via inco.getFee(); if any silently became
    // nonpayable the dapp would revert on every jump with no useful message.
    for (const name of ['createGame', 'jump', 'revealEjection']) {
      const fn = client.find((e) => e.type === 'function' && e.name === name);
      expect(fn, `${name} missing from the client ABI`).to.not.be.undefined;
      expect(fn!.stateMutability, `${name} must stay payable`).to.equal('payable');
    }
  });
});
