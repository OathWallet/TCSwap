/**
 * Modifications © 2025 Horizontal Systems.
 */

import { type Chain, getChainConfig } from "@tcswap/types";
import type { BrowserProvider, JsonRpcProvider } from "ethers";
import { USwapError } from "../modules/uSwapError";
import {
  type EIP6963AnnounceProviderEvent,
  type EIP6963Provider,
  type EthereumWindowProvider,
  type NetworkParams,
  WalletOption,
} from "../types";
import { warnOnce } from "./others";

declare const window: {
  ethereum: EthereumWindowProvider;
  trustwallet: EthereumWindowProvider;
  coinbaseWalletExtension: EthereumWindowProvider;
  braveSolana: any;
  bitkeep?: { ethereum: EthereumWindowProvider };
  ctrl?: { ethereum: EthereumWindowProvider };
  $onekey?: { ethereum: EthereumWindowProvider };
  vultisig?: { ethereum: EthereumWindowProvider };
} & Window;

export function isWeb3Detected() {
  return typeof window.ethereum !== "undefined";
}

export function isDetected(walletOption: WalletOption) {
  return listWeb3EVMWallets().includes(walletOption);
}

export function listWeb3EVMWallets() {
  const metamaskEnabled = getMetaMaskProvider();
  const ctrlEnabled = window?.ctrl || window?.ethereum?.__XDEFI;
  const vultisigEnabled = window?.vultisig;
  const braveEnabled = window?.ethereum?.isBraveWallet;
  const rabbyEnabled = window?.ethereum?.isRabby || getEIP6963Provider(RABBY_RDNS);
  const trustEnabled = window?.ethereum?.isTrust || window?.trustwallet;
  const coinbaseEnabled =
    (window?.ethereum?.overrideIsMetaMask && window?.ethereum?.selectedProvider?.isCoinbaseWallet) ||
    window?.coinbaseWalletExtension;
  const bitgetEnabled = window?.bitkeep?.ethereum;
  const onekeyEnabled = window?.$onekey?.ethereum;

  const wallets = [];
  if (metamaskEnabled) wallets.push(WalletOption.METAMASK);
  if (ctrlEnabled) wallets.push(WalletOption.CTRL);
  if (vultisigEnabled) wallets.push(WalletOption.VULTISIG);
  if (braveEnabled) wallets.push(WalletOption.BRAVE);
  if (rabbyEnabled) wallets.push(WalletOption.RABBY);
  if (trustEnabled) wallets.push(WalletOption.TRUSTWALLET_WEB);
  if (coinbaseEnabled) wallets.push(WalletOption.COINBASE_WEB);
  if (okxMobileEnabled()) wallets.push(WalletOption.OKX_MOBILE);
  if (bitgetEnabled) wallets.push(WalletOption.BITGET);
  if (onekeyEnabled) wallets.push(WalletOption.ONEKEY);

  return wallets;
}

export async function switchEVMWalletNetwork(provider: BrowserProvider, chain: Chain, networkParams?: NetworkParams) {
  const chainConfig = getChainConfig(chain);

  try {
    await providerRequest({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainConfig.chainIdHex }],
      provider,
    });
  } catch (error) {
    if (!networkParams) {
      throw new USwapError("helpers_failed_to_switch_network", { error: error, reason: "networkParams not provided" });
    }
    await addEVMWalletNetwork(provider, networkParams);
  }
}

export function filterSupportedChains<T extends string[]>({
  chains,
  supportedChains,
  walletType,
}: {
  chains: Chain[];
  supportedChains: T;
  walletType?: WalletOption;
}) {
  const supported = chains.filter((chain) => !chain || supportedChains.includes(chain));

  if (supported.length === 0) {
    throw new USwapError("wallet_chain_not_supported", { chain: chains.join(", "), wallet: walletType });
  }

  const unsupported = chains.filter((chain) => !supportedChains.includes(chain));

  warnOnce({
    condition: unsupported.length > 0,
    id: `wallet_chain_not_supported_${walletType}`,
    warning: `${walletType} wallet does not support the following chains: ${unsupported.join(
      ", ",
    )}. These chains will be ignored.`,
  });

  return supported as T;
}

// Parallel wrapped calls share one switch instead of each opening a prompt.
const pendingSwitches = new WeakMap<object, Map<Chain, Promise<void>>>();

function switchNetworkOnce(provider: BrowserProvider, chain: Chain, networkParams?: NetworkParams) {
  const byChain = pendingSwitches.get(provider) ?? new Map<Chain, Promise<void>>();
  pendingSwitches.set(provider, byChain);

  const pending = byChain.get(chain);
  if (pending) return pending;

  const switching = switchEVMWalletNetwork(provider, chain, networkParams).finally(() => byChain.delete(chain));
  byChain.set(chain, switching);
  return switching;
}

/** `networkParams` lets the switch add a network the wallet does not know yet. */
export function wrapMethodWithNetworkSwitch<T extends (...args: any[]) => any>(
  func: T,
  provider: BrowserProvider,
  chain: Chain,
  networkParams?: NetworkParams,
) {
  return (async (...args: any[]) => {
    const { chainIdHex } = getChainConfig(chain);
    // `chainId` is a bigint and `chainIdHex` a "0x..." string, so comparing their text never matched:
    // every wrapped call asked the wallet to switch to the network it was already on, one round trip
    // (and in some wallets one prompt) per balance, estimate, approve and transfer.
    if (chainIdHex && (await provider.getNetwork()).chainId === BigInt(chainIdHex)) {
      return func(...args);
    }
    try {
      await switchNetworkOnce(provider, chain, networkParams);
    } catch (error) {
      throw new USwapError({ errorKey: "helpers_failed_to_switch_network", info: { error } });
    }
    return func(...args);
  }) as unknown as T;
}

export function prepareNetworkSwitch<T extends Record<string, unknown>, M extends keyof T>({
  toolbox,
  chain,
  provider = window.ethereum,
  methodNames = [],
  networkParams,
}: {
  toolbox: T;
  chain: Chain;
  provider?: BrowserProvider | JsonRpcProvider;
  methodNames?: M[];
  networkParams?: NetworkParams;
}) {
  const methodsToWrap = [
    ...methodNames,
    "approve",
    "approvedAmount",
    "call",
    "sendTransaction",
    "transfer",
    "isApproved",
    "approvedAmount",
    "EIP1193SendTransaction",
    "getFeeData",
    "broadcastTransaction",
    "estimateCall",
    "estimateGasLimit",
    "estimateGasPrices",
    "createContractTxObject",
    // Read the wallet's network too, so they need it on `chain` now that connecting no longer switches.
    "createApprovalTx",
    "createTransaction",
    "createTransferTx",
    "estimateTransactionFee",
    "estimateL1Gas",
    "estimateL1GasCost",
    "estimateL2GasCost",
    "estimateTotalGasCost",
    "getL1GasPrice",
  ] as M[];
  const wrappedMethods = methodsToWrap.reduce((object, methodName) => {
    if (!toolbox[methodName]) return object;

    const method = toolbox[methodName];

    if (typeof method !== "function") return object;

    // @ts-expect-error
    const wrappedMethod = wrapMethodWithNetworkSwitch(method, provider, chain, networkParams);

    // biome-ignore lint/performance/noAccumulatingSpread: valid use case
    return { ...object, [methodName]: wrappedMethod };
  }, {});

  return { ...toolbox, ...wrappedMethods };
}

export function addEVMWalletNetwork(provider: BrowserProvider, networkParams: NetworkParams) {
  return providerRequest({ method: "wallet_addEthereumChain", params: [networkParams], provider });
}

export function addAccountsChangedCallback(callback: () => void) {
  window.ethereum?.on("accountsChanged", () => callback());
  window.ctrl?.ethereum.on("accountsChanged", () => callback());
}

export function getETHDefaultWallet() {
  const { isTrust, isBraveWallet, isRabby, __XDEFI, overrideIsMetaMask, selectedProvider } = window?.ethereum || {};
  if (isTrust) return WalletOption.TRUSTWALLET_WEB;
  if (isBraveWallet) return WalletOption.BRAVE;
  if (isRabby) return WalletOption.RABBY;
  if (overrideIsMetaMask && selectedProvider?.isCoinbaseWallet) return WalletOption.COINBASE_WEB;
  if (__XDEFI) return WalletOption.CTRL;
  if (window?.$onekey?.ethereum) return WalletOption.ONEKEY;
  return WalletOption.METAMASK;
}

export function getEIP6963Wallets() {
  const providers: EIP6963Provider[] = [];

  function onAnnouncement(event: EIP6963AnnounceProviderEvent) {
    if (providers.map((p) => p.info.uuid).includes(event.detail.info.uuid)) return;
    providers.push(event.detail);
  }

  window.addEventListener("eip6963:announceProvider", onAnnouncement);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  function removeEIP6963EventListener() {
    window.removeEventListener("eip6963:announceProvider", onAnnouncement);
  }

  return { providers, removeEIP6963EventListener };
}

export const METAMASK_RDNS = "io.metamask";
export const RABBY_RDNS = "io.rabby";

/**
 * MetaMask by its EIP-6963 announcement, else `window.ethereum` unless Brave, Rabby or Binance holds it — Rabby and
 * Binance, as default wallet, take it and flag it isMetaMask as well. Other wallets injecting there without
 * announcing pass as MetaMask.
 */
export function getMetaMaskProvider() {
  if (typeof window === "undefined") return undefined;

  const ethereum = window.ethereum;
  return (
    getEIP6963Provider(METAMASK_RDNS) ??
    (ethereum && !ethereum.isBraveWallet && !ethereum.isRabby && !ethereum.isBinance ? ethereum : undefined)
  );
}

/** The provider an extension announces over EIP-6963 under `rdns`, whichever extension holds `window.ethereum`. */
export function getEIP6963Provider(rdns: string) {
  if (typeof window === "undefined") return undefined;

  const { providers, removeEIP6963EventListener } = getEIP6963Wallets();
  removeEIP6963EventListener();
  return providers.find((p) => p.info.rdns === rdns)?.provider;
}

export function okxMobileEnabled() {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod|ios/i.test(ua);
  const isAndroid = /android|XiaoMi|MiuiBrowser/i.test(ua);
  const isMobile = isIOS || isAndroid;
  const isOKApp = /OKApp/i.test(ua);

  return isMobile && isOKApp;
}

export function providerRequest({
  provider,
  params,
  method,
}: {
  provider?: BrowserProvider;
  params?: any;
  method:
    | "wallet_addEthereumChain"
    | "wallet_switchEthereumChain"
    | "eth_requestAccounts"
    | "eth_sendTransaction"
    | "eth_signTransaction";
}) {
  if (!provider?.send) {
    throw new USwapError("helpers_not_found_provider");
  }

  const providerParams = params ? (Array.isArray(params) ? params : [params]) : [];
  return provider.send(method, providerParams);
}
