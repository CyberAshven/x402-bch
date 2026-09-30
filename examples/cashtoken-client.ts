import type { BchProvider, BchTransactionRequest } from '../src/index.js';
import { createWalletAdapter } from './common.js';

const TOKEN_CATEGORY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** Wallet request for a fungible CashToken payment. */
export const fungibleTokenRequest: BchTransactionRequest = {
  network: 'chipnet',
  recipient: { address: 'bchtest:pp...' },
  amount: 1000n,
  token: { category: TOKEN_CATEGORY, amount: 25n },
};

/** Wallet request for an NFT CashToken payment. */
export const nftRequest: BchTransactionRequest = {
  network: 'chipnet',
  recipient: { address: 'bchtest:pp...' },
  amount: 1000n,
  token: {
    category: TOKEN_CATEGORY,
    amount: 0n,
    nft: { capability: 'none', commitment: 'deadbeef' },
  },
};

export function createTokenWallet(provider: BchProvider) {
  return createWalletAdapter(async (request) => {
    if (request.network !== (provider.network === 'bch:bchtest' ? 'chipnet' : 'mainnet')) {
      throw new Error('wallet network and provider network do not match');
    }
    // Replace with wallet-owned CashToken UTXO selection, change, and signing.
    return provider.network === 'bch:bchtest' ? new Uint8Array() : new Uint8Array();
  });
}
