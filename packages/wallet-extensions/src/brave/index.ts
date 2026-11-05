/**
 * Modifications © 2025 Horizontal Systems.
 */

import { Chain, type EVMChain, EVMChains, filterSupportedChains, USwapError, WalletOption } from "@tcswap/helpers";
import type { SolanaProvider } from "@tcswap/toolboxes/solana";
import { createWallet, getWalletSupportedChains } from "@tcswap/wallet-core";
import type { Eip1193Provider } from "ethers";
import { connectChainProviders, connectSolanaProvider, createEVMWalletMethods } from "../helpers/multi-provider";

/**
 * Brave Wallet: an EVM account (`window.braveEthereum`) and a Solana account (`window.braveSolana`).
 * The shared `window.ethereum` / `window.solana` slots count as Brave only when they carry `isBraveWallet`.
 */
const BRAVE_RDNS = "com.brave.wallet";

// Standalone so `getWalletMethods` can be typed from it: typing it from the wallet object would
// make the wallet's own type inference circular now that `connectChainProviders` infers from both.
const braveChains = [...EVMChains, Chain.Solana];

type BraveFlagged = { isBraveWallet?: boolean };
type Listenable<Event extends string, Handler> = {
  on?: (event: Event, handler: Handler) => void;
  removeListener?: (event: Event, handler: Handler) => void;
};

type BraveEVMProvider = Eip1193Provider & BraveFlagged & Listenable<"accountsChanged", (accounts: string[]) => void>;
type BraveSolanaProvider = SolanaProvider &
  BraveFlagged &
  Listenable<"accountChanged", (publicKey: { toString(): string } | null) => void>;

export const braveWallet = createWallet({
  connect: ({ addChain, supportedChains, walletType }) =>
    async function connectBrave(chains: Chain[]) {
      const filteredChains = filterSupportedChains({ chains, supportedChains, walletType });

      return await connectChainProviders({
        addChain,
        chains: filteredChains,
        getWalletMethods,
        walletName: "Brave Wallet",
        walletType,
      });
    },
  name: "connectBrave",
  supportedChains: braveChains,
  walletType: WalletOption.BRAVE,
});

export const BRAVE_SUPPORTED_CHAINS = getWalletSupportedChains(braveWallet);
export type BraveSupportedChain = (typeof braveChains)[number];

function getWalletMethods(chain: BraveSupportedChain) {
  if (chain === Chain.Solana) return getSolanaWalletMethods();
  if (EVMChains.includes(chain as EVMChain)) return getEVMWalletMethods(chain as EVMChain);

  throw new USwapError("wallet_brave_chain_not_supported", { chain });
}

const getEVMWalletMethods = createEVMWalletMethods({
  getProvider: getBraveEVMProvider,
  notFoundError: "wallet_brave_evm_not_found",
});

function getSolanaWalletMethods() {
  return connectSolanaProvider({
    noAddressError: "wallet_brave_no_address",
    notFoundError: "wallet_brave_solana_not_found",
    provider: getBraveSolanaProvider(),
  });
}

/** EIP-6963 goes last: requesting it makes every installed EVM wallet announce itself. */
export function getBraveEVMProvider(): BraveEVMProvider | undefined {
  const injected = (window as { braveEthereum?: BraveEVMProvider }).braveEthereum;
  if (injected) return injected;

  if (window.ethereum?.isBraveWallet) return window.ethereum as unknown as BraveEVMProvider;

  return announcedEVMProvider();
}

export function getBraveSolanaProvider(): BraveSolanaProvider | undefined {
  const injected = window.braveSolana as BraveSolanaProvider | undefined;
  if (injected) return injected;

  const shared = window.solana as BraveSolanaProvider | undefined;
  return shared?.isBraveWallet ? shared : undefined;
}

/**
 * Calls `onChange` when the user switches account on either side, with `undefined` when the Solana
 * account switched to is not connected to the site. Locking the EVM side is not a switch. Returns the unsubscribe.
 */
export function watchBraveAccounts(onChange: (address: string | undefined) => void) {
  const evm = getBraveEVMProvider();
  const solana = getBraveSolanaProvider();

  const onEVMAccounts = (accounts: string[]) => {
    if (accounts[0]) onChange(accounts[0]);
  };
  const onSolanaAccount = (publicKey: { toString(): string } | null) => onChange(publicKey?.toString());

  evm?.on?.("accountsChanged", onEVMAccounts);
  solana?.on?.("accountChanged", onSolanaAccount);

  return () => {
    evm?.removeListener?.("accountsChanged", onEVMAccounts);
    solana?.removeListener?.("accountChanged", onSolanaAccount);
  };
}

/** Brave answers the EIP-6963 request synchronously. */
function announcedEVMProvider(): BraveEVMProvider | undefined {
  let announced: BraveEVMProvider | undefined;

  const onAnnounce = (event: Event) => {
    const { info, provider } = (event as CustomEvent).detail || {};
    if (!announced && info?.rdns === BRAVE_RDNS) announced = provider;
  };

  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  return announced;
}
