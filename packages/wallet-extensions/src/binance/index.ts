import {
  Chain,
  type EVMChain,
  EVMChains,
  filterSupportedChains,
  getEIP6963Provider,
  USwapError,
  WalletOption,
} from "@tcswap/helpers";
import type { SolanaProvider } from "@tcswap/toolboxes/solana";
import type { TronSignedTransaction, TronSigner, TronTransaction } from "@tcswap/toolboxes/tron";
import { createWallet, getWalletSupportedChains } from "@tcswap/wallet-core";
import type { Eip1193Provider } from "ethers";
import { addNestedSegwitRedeemScripts } from "../helpers/bitcoin";
import { connectChainProviders, connectSolanaProvider, createEVMWalletMethods } from "../helpers/multi-provider";

/**
 * The Binance Web3 Wallet browser extension. Everything it injects lives under the
 * `window.binancew3w` namespace nothing else writes to: an EIP-1193 provider for EVM chains
 * (`ethereum`, also announced over EIP-6963 and flagged `isBinance` on the shared slot it owns as
 * the default wallet), a Phantom-shaped Solana provider (`solana`), a Unisat-compatible Bitcoin
 * provider (`bitcoin` — some builds publish only the shared `window.unisat` slot, flagged
 * `isBinance`), and its own Tron provider (`tron`), which answers `getAccount()` and
 * `signTransaction()` rather than TronLink's `tronWeb` surface.
 */
const binanceEVMChains = [
  Chain.Arbitrum,
  Chain.Avalanche,
  Chain.Base,
  Chain.BinanceSmartChain,
  Chain.Ethereum,
  Chain.Optimism,
  Chain.Polygon,
] as const;

// Standalone so `getWalletMethods` can be typed from it: typing it from the wallet object would
// make the wallet's own type inference circular now that `connectChainProviders` infers from both.
const binanceChains = [...binanceEVMChains, Chain.Bitcoin, Chain.Solana, Chain.Tron];

type BinanceToSignInput = { address: string; index: number; sighashTypes?: number[] };

export type BinanceBitcoinProvider = {
  getAccounts: () => Promise<string[]>;
  requestAccounts: () => Promise<string[]>;
  getPublicKey: () => Promise<string>;
  signPsbt: (
    psbtHex: string,
    options: { autoFinalized?: boolean; toSignInputs?: BinanceToSignInput[] },
  ) => Promise<string>;
};

export type BinanceTronProvider = {
  getAccount: () => Promise<{ address: string }>;
  signTransaction: (transaction: TronTransaction) => Promise<TronSignedTransaction>;
  disconnect?: () => Promise<void>;
};

export const binanceWallet = createWallet({
  connect: ({ addChain, supportedChains, walletType }) =>
    async function connectBinance(chains: Chain[]) {
      const filteredChains = filterSupportedChains({ chains, supportedChains, walletType });

      return await connectChainProviders({
        addChain,
        chains: filteredChains,
        getWalletMethods,
        walletName: "Binance Wallet",
        walletType,
      });
    },
  name: "connectBinance",
  supportedChains: binanceChains,
  walletType: WalletOption.BINANCE,
});

export const BINANCE_SUPPORTED_CHAINS = getWalletSupportedChains(binanceWallet);
export type BinanceSupportedChain = (typeof binanceChains)[number];

function getWalletMethods(chain: BinanceSupportedChain) {
  if (chain === Chain.Bitcoin) return getBitcoinWalletMethods();
  if (chain === Chain.Solana) return getSolanaWalletMethods();
  if (chain === Chain.Tron) return getTronWalletMethods();
  if (EVMChains.includes(chain as EVMChain)) return getEVMWalletMethods(chain as EVMChain);

  throw new USwapError("wallet_binance_chain_not_supported", { chain });
}

/**
 * The extension injects late, and per ecosystem: `binancew3w` can already be there while a provider
 * it carries is still missing. Poll briefly before giving up — Binance's own Tron adapter does the
 * same (100ms steps for up to 2s).
 */
async function waitForProvider<T>(get: () => T | undefined): Promise<T | undefined> {
  const interval = 100;
  const timeout = 2_000;

  for (let waited = 0; ; waited += interval) {
    const provider = get();
    if (provider || waited >= timeout) return provider;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

const getEVMWalletMethods = createEVMWalletMethods({
  getProvider: () => waitForProvider(getBinanceEVMProvider),
  notFoundError: "wallet_binance_not_found",
});

async function getSolanaWalletMethods() {
  return connectSolanaProvider({
    noAddressError: "wallet_binance_no_address",
    notFoundError: "wallet_binance_not_found",
    provider: await waitForProvider(getBinanceSolanaProvider),
  });
}

async function getBitcoinWalletMethods() {
  const provider = await waitForProvider(getBinanceBitcoinProvider);
  if (!provider) throw new USwapError("wallet_binance_not_found", { chain: Chain.Bitcoin });

  const { getUtxoToolbox } = await import("@tcswap/toolboxes/utxo");
  const { Psbt } = await import("bitcoinjs-lib");

  // `getAccounts` answers with what the site was already granted without opening the wallet;
  // `requestAccounts` is the call that opens Binance.
  const granted = await provider.getAccounts().catch(() => [] as string[]);
  const [address] = granted.length > 0 ? granted : await provider.requestAccounts();
  if (!address) throw new USwapError("wallet_binance_no_address", { chain: Chain.Bitcoin });

  // The account's public key is what derives the redeemScript a nested SegWit (3…) input needs.
  const publicKey = await provider.getPublicKey().catch(() => undefined);

  const signer = {
    getAddress: async () => address,
    signTransaction: async (psbt: InstanceType<typeof Psbt>) => {
      addNestedSegwitRedeemScripts(psbt, publicKey);

      // Binance would otherwise finalize the inputs itself; leave that to the toolbox, which
      // finalizes with its own bitcoinjs-lib (ECC-initialized for Taproot) after signing. Every
      // input is the connected account's — the toolbox built them from its UTXOs — so each one is
      // named rather than left to the wallet's own matching.
      const signedPsbt = await provider.signPsbt(psbt.toHex(), {
        autoFinalized: false,
        toSignInputs: psbt.data.inputs.map((_, index) => ({ address, index })),
      });

      return Psbt.fromHex(signedPsbt);
    },
  };

  const toolbox = await getUtxoToolbox(Chain.Bitcoin, { signer });

  return { ...toolbox, address };
}

async function getTronWalletMethods() {
  const provider = await waitForProvider(getBinanceTronProvider);
  if (!provider) throw new USwapError("wallet_binance_not_found", { chain: Chain.Tron });

  const { createTronToolbox } = await import("@tcswap/toolboxes/tron");

  const { address } = await provider.getAccount();
  if (!address) throw new USwapError("wallet_binance_no_address", { chain: Chain.Tron });

  const signer: TronSigner = {
    getAddress: async () => address,
    signTransaction: (transaction) => provider.signTransaction(transaction),
  };

  const toolbox = await createTronToolbox({ signer });
  const disconnect = () => provider.disconnect?.().catch(() => undefined);

  return { ...toolbox, address, disconnect };
}

/** The rdns the extension announces its EVM provider with over EIP-6963. */
const BINANCE_RDNS = "com.binance.wallet";

export function getBinanceEVMProvider(): Eip1193Provider | undefined {
  const injected = window.binancew3w?.ethereum;
  if (injected) return injected;

  // Binance made the default wallet also owns the shared slot, and flags itself there.
  const shared = window.ethereum as unknown as (Eip1193Provider & { isBinance?: boolean }) | undefined;
  if (shared?.isBinance) return shared;

  // EIP-6963 goes last: requesting it makes every installed EVM wallet announce itself.
  return getEIP6963Provider(BINANCE_RDNS);
}

export function getBinanceSolanaProvider(): SolanaProvider | undefined {
  return window.binancew3w?.solana;
}

export function getBinanceBitcoinProvider(): BinanceBitcoinProvider | undefined {
  const injected = window.binancew3w?.bitcoin;
  if (injected) return injected;

  // Some builds publish only the shared Unisat-compatible slot, flagged as Binance's.
  const shared = (window as { unisat?: BinanceBitcoinProvider & { isBinance?: boolean } }).unisat;
  return shared?.isBinance ? shared : undefined;
}

export function getBinanceTronProvider(): BinanceTronProvider | undefined {
  return window.binancew3w?.tron;
}
