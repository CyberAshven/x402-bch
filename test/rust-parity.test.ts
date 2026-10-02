import { describe, expect, it } from 'vitest';
import { ExactBchScheme } from '../src/exact/client';
import { ExactBchFacilitatorScheme } from '../src/exact/facilitator';
import { ExactBchServerScheme } from '../src/exact/server';
import { BCH_MAINNET_BIP44_COIN_TYPE } from '../src/constants';
import {
  MAX_TOKEN_COMMITMENT_LENGTH,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
} from '../src/crypto';
import { FulcrumProvider } from '../src/provider';
import { createSecp256k1BchSignerFromMnemonic } from '../src/signer';
import type { ExactBchRequirements } from '../src/types';
import vectors from './fixtures/bch-exact-offline-vectors.json';

/**
 * `bch-exact-offline-vectors.json` is written by the Rust `x402-chain-bch` test
 * `offline_nft_commitments_pay_every_supported_destination` with
 * `BCH_BROWSER_VECTORS=<path>`. That test also checks the same file, so the two
 * packages cannot drift without one of them failing. Every case is offline.
 */
type OfflineCase = {
  id: string;
  mode: 'mnemonic' | 'wallet';
  expect: 'ok' | 'reject';
  requirements: ExactBchRequirements;
  listunspent: unknown[];
  transactions: Record<string, unknown>;
  transactionHex: string | null;
};

const cases = vectors.cases as unknown as OfflineCase[];
const accepted = cases.filter((item) => item.expect === 'ok');
const signed = accepted.filter((item) => item.mode === 'mnemonic');
const rejected = cases.filter((item) => item.expect === 'reject' && item.mode === 'mnemonic');

function providerFor(item: OfflineCase): FulcrumProvider {
  return new FulcrumProvider(item.requirements.network, {
    request: async (method, params) => {
      if (method === 'blockchain.transaction.get') return item.transactions[params[0] as string];
      if (method === 'blockchain.scripthash.listunspent') return item.listunspent;
      throw new Error(`unexpected Fulcrum method ${method}`);
    },
  });
}

function payer() {
  return createSecp256k1BchSignerFromMnemonic(vectors.mnemonic, {
    coinType: BCH_MAINNET_BIP44_COIN_TYPE,
  });
}

function commitmentLength(item: OfflineCase): number {
  const token = item.requirements.extra.token as { nft?: { commitment?: string } } | undefined;
  return (token?.nft?.commitment ?? '').length / 2;
}

describe('offline vectors from the Rust x402-chain-bch crate', () => {
  it('covers the 128-byte commitment limit on every destination', () => {
    expect(vectors.offline).toBe(true);
    expect(cases).toHaveLength(37);
    for (const destination of ['p2pkh', 'p2sh20', 'p2sh32']) {
      expect(signed.some((item) => item.id === `mnemonic-nft-only-${destination}-128`)).toBe(true);
    }
    expect(rejected.some((item) => commitmentLength(item) > MAX_TOKEN_COMMITMENT_LENGTH)).toBe(
      true,
    );
  });

  it.each(cases)('$id: advertises the same CashToken value as Rust', async (item) => {
    const { value, ...omitted } = item.requirements.extra;
    const explicit = item.id.includes('-explicit-');
    const enhanced = new ExactBchServerScheme().enhancePaymentRequirements(
      { ...item.requirements, extra: explicit ? item.requirements.extra : omitted },
      { x402Version: 2, scheme: 'exact', network: item.requirements.network },
      [],
    );
    if (commitmentLength(item) > MAX_TOKEN_COMMITMENT_LENGTH) {
      await expect(enhanced).rejects.toThrow('CashToken commitment is too large');
    } else {
      await expect(enhanced).resolves.toMatchObject({ extra: { value } });
    }
  });

  it.each(accepted)('$id: verifies the Rust-built transaction', async (item) => {
    const facilitator = new ExactBchFacilitatorScheme(providerFor(item));
    const payload = {
      x402Version: 2,
      payload: { transaction: bytesToBase64(hexToBytes(item.transactionHex as string)) },
      accepted: item.requirements,
    };
    await expect(facilitator.verify(payload, item.requirements)).resolves.toMatchObject({
      isValid: true,
    });
  });

  it.each(signed)('$id: builds the same transaction bytes as Rust', async (item) => {
    const client = new ExactBchScheme(payer(), providerFor(item));
    const created = await client.createPaymentPayload(2, item.requirements);
    expect(bytesToHex(base64ToBytes(created.payload.transaction as string))).toBe(
      item.transactionHex,
    );
  });

  it.each(rejected)('$id: rejects the payment like Rust', async (item) => {
    const client = new ExactBchScheme(payer(), providerFor(item));
    await expect(client.createPaymentPayload(2, item.requirements)).rejects.toThrow(
      /merchant output is dust|CashToken commitment is too large/,
    );
  });
});
