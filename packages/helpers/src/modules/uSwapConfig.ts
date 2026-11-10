/**
 * Modifications © 2025 Horizontal Systems.
 */

import {
  AllChains,
  type Chain,
  getChainConfig,
  StagenetChain,
  StagenetMAYAConfig,
  StagenetTHORConfig,
} from "@tcswap/types";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import type { BalanceResponse, QuoteRequest, QuoteResponse, QuoteResponseRoute } from "../api";
import { WalletOption } from "../types";
import type { FeeMultiplierConfig } from "./feeMultiplier";

export type USwapConfigIntegrations = {
  chainflip?: { useSDKBroker?: boolean; brokerUrl: string };
  coinbase?: {
    appName: string;
    appLogoUrl?: string | null;
    darkMode?: boolean;
    linkAPIUrl?: string;
    overrideIsMetaMask?: boolean;
    overrideIsCoinbaseWallet?: boolean;
    overrideIsCoinbaseBrowser?: boolean;
    headlessMode?: boolean;
    reloadOnDisconnect?: boolean;
  };
  nearWalletSelector?: { contractId?: string };
  trezor?: { email: string; appUrl: string };
  keepKey?: { name: string; imageUrl: string; basePath: string; url: string };
  radix: {
    dAppDefinitionAddress: string;
    applicationName: string;
    applicationVersion: string;
    network: { networkId: number; networkName: string; dashboardBase: string };
  };
};

export type CustomApiEndpoints = {
  getBalance: ({ chain, address }: { chain: Chain; address: string }) => Promise<BalanceResponse>;
  getQuote: (json: QuoteRequest) => Promise<QuoteResponse>;
  getRouteWithTx: (json: { routeId: string }) => Promise<QuoteResponseRoute>;
};

const rpcUrls = AllChains.reduce(
  (acc, chain) => {
    if (!acc.THOR_STAGENET) {
      acc[StagenetChain.Maya] = StagenetMAYAConfig.rpcUrls;
      acc[StagenetChain.THORChain] = StagenetTHORConfig.rpcUrls;
    }

    acc[chain] = getChainConfig(chain).rpcUrls;
    return acc;
  },
  {} as { [key in Chain | StagenetChain]: string[] },
);

const initialState = {
  apiKeys: {
    blockchair: "",
    keepKey: "",
    memoless: "",
    passkeys: "",
    uSwap: "",
    walletConnectProjectId: "",
    xaman: "",
  },
  chains: AllChains,
  endpoints: {} as CustomApiEndpoints,
  envs: {
    apiUrl: "https://api.thorchain.org/v1",
    blockchairApiUrl: null as string | null,
    devApiUrl: "https://api.thorchain.org/v1",
    experimental_apiKey: null as string | null,
    experimental_apiUrlQuote: null as string | null,
    experimental_apiUrlSwap: null as string | null,
    isDev: false,
    isStagenet: false,
    memolessApiUrl: "https://api.thorchain.org/memoless/api/v1",
  },
  feeMultipliers: undefined as FeeMultiplierConfig | undefined,
  integrations: {
    radix: {
      applicationName: "TCSwap Playground",
      applicationVersion: "0.0.1",
      dAppDefinitionAddress: "account_rdx128r289p58222hcvev7frs6kue76pl7pdcnw8725aw658v0zggkh9ws",
      network: { dashboardBase: "https://dashboard.radixdlt.com", networkId: 1, networkName: "mainnet" },
    },
  } as USwapConfigIntegrations,

  requestOptions: { retry: { backoffMultiplier: 2, baseDelay: 300, maxDelay: 5000, maxRetries: 3 }, timeoutMs: 30000 },
  rpcUrls,
  wallets: Object.values(WalletOption),
};
type USwapState = typeof initialState;
export type RequestOptionsInput = {
  retry?: Partial<USwapState["requestOptions"]["retry"]>;
  timeoutMs?: USwapState["requestOptions"]["timeoutMs"];
};

export type USwapConfigState = {
  apiKeys?: Partial<USwapState["apiKeys"]>;
  chains?: USwapState["chains"];
  endpoints?: Partial<CustomApiEndpoints>;
  envs?: Partial<USwapState["envs"]>;
  integrations?: Partial<USwapConfigIntegrations>;
  rpcUrls?: Partial<USwapState["rpcUrls"]>;
  wallets?: USwapState["wallets"];
  feeMultipliers?: FeeMultiplierConfig;
};

type USwapConfigStore = USwapState & {
  setApiKey: (key: keyof USwapState["apiKeys"], apiKey: string) => void;
  setConfig: (config: USwapConfigState) => void;
  setEnv: <T extends keyof USwapState["envs"]>(key: T, value: USwapState["envs"][T]) => void;
  setEndpoint: <T extends keyof CustomApiEndpoints>(key: T, endpoint: CustomApiEndpoints[T]) => void;
  setRpcUrl: (chain: keyof USwapState["rpcUrls"], url: string[]) => void;
  setRequestOptions: (options: RequestOptionsInput) => void;
  setIntegrationConfig: (
    integration: keyof USwapState["integrations"],
    config: USwapConfigIntegrations[keyof USwapConfigIntegrations],
  ) => void;
  setFeeMultipliers: (multipliers: FeeMultiplierConfig) => void;
};

export const useUSwapStore = create<USwapConfigStore>((set) => ({
  ...initialState,

  setApiKey: (key, apiKey) => set((s) => ({ apiKeys: { ...s.apiKeys, [key]: apiKey } })),
  setConfig: (config) =>
    set((s) => ({
      apiKeys: { ...s.apiKeys, ...config?.apiKeys },
      chains: s.chains.concat(config?.chains || []),
      endpoints: { ...s.endpoints, ...config?.endpoints },
      envs: { ...s.envs, ...config?.envs },
      feeMultipliers: config?.feeMultipliers || s.feeMultipliers,
      integrations: { ...s.integrations, ...config?.integrations },
      rpcUrls: { ...s.rpcUrls, ...config?.rpcUrls },
      wallets: s.wallets.concat(config?.wallets || []),
    })),
  setEndpoint: (key, endpoint) => set((s) => ({ endpoints: { ...s.endpoints, [key]: endpoint } })),
  setEnv: (key, value) => set((s) => ({ envs: { ...s.envs, [key]: value } })),
  setFeeMultipliers: (multipliers) => set(() => ({ feeMultipliers: multipliers })),
  setIntegrationConfig: (integration, config) =>
    set((s) => ({ integrations: { ...s.integrations, [integration]: config } })),
  setRequestOptions: (options) =>
    set((s) => ({
      requestOptions: {
        retry: { ...s.requestOptions.retry, ...options.retry },
        timeoutMs: options.timeoutMs || s.requestOptions.timeoutMs,
      },
    })),
  setRpcUrl: (chain, url) => set((s) => ({ rpcUrls: { ...s.rpcUrls, [chain]: url } })),
}));

export const useUSwapConfig = () =>
  useUSwapStore(
    useShallow((state) => ({
      apiKeys: state?.apiKeys,
      chains: state?.chains,
      endpoints: state?.endpoints,
      envs: state?.envs,
      feeMultipliers: state?.feeMultipliers,
      integrations: state?.integrations,
      rpcUrls: state?.rpcUrls,
      wallets: state?.wallets,
    })),
  );

export const USwapConfig = {
  get: <T extends keyof USwapState>(key: T) => useUSwapStore.getState()[key],
  getState: useUSwapStore.getState,
  reinitialize: () => useUSwapStore.setState(initialState),
  set: <T extends USwapConfigState>(config: T) => useUSwapStore.getState().setConfig(config),

  setApiKey: <T extends keyof USwapState["apiKeys"]>(key: T, apiKey: string) =>
    useUSwapStore.getState().setApiKey(key, apiKey),
  setEndpoint: <T extends keyof CustomApiEndpoints>(key: T, endpoint: CustomApiEndpoints[T]) =>
    useUSwapStore.getState().setEndpoint(key, endpoint),
  setEnv: <T extends keyof USwapState["envs"]>(key: T, value: USwapState["envs"][T]) =>
    useUSwapStore.getState().setEnv(key, value),
  setFeeMultipliers: (multipliers: FeeMultiplierConfig) => useUSwapStore.getState().setFeeMultipliers(multipliers),
  setIntegrationConfig: <T extends keyof USwapState["integrations"]>(
    integration: T,
    config: USwapConfigIntegrations[T],
  ) => useUSwapStore.getState().setIntegrationConfig(integration, config),
  setRequestOptions: (options: RequestOptionsInput) => useUSwapStore.getState().setRequestOptions(options),
  setRpcUrl: <T extends keyof USwapState["rpcUrls"]>(chain: T, urls: string[]) =>
    useUSwapStore.getState().setRpcUrl(chain, urls),
};
