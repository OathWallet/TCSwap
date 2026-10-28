/**
 * Modifications © 2025 Horizontal Systems.
 */

import { Chain, USwapConfig } from "@tcswap/helpers";
import type { SessionTypes } from "@walletconnect/types";

import {
  ARBITRUM_ONE_MAINNET_ID,
  AURORA_MAINNET_ID,
  AVALANCHE_MAINNET_ID,
  BASE_MAINNET_ID,
  BERACHAIN_MAINNET_ID,
  BSC_MAINNET_ID,
  COSMOS_HUB_MAINNET_ID,
  DEFAULT_APP_METADATA,
  ETHEREUM_MAINNET_ID,
  KUJIRA_MAINNET_ID,
  MAYACHAIN_MAINNET_ID,
  MONAD_MAINNET_ID,
  NEAR_MAINNET_ID,
  NEAR_TESTNET_ID,
  OPTIMISM_MAINNET_ID,
  POLYGON_MAINNET_ID,
  THORCHAIN_LEGACY_ID,
  THORCHAIN_MAINNET_ID,
  TRON_MAINNET_ID,
  XLAYER_MAINNET_ID,
} from "./constants";
import type { WalletconnectOptions } from "./types";

/**
 * Every CAIP-2 id a wallet may know the chain by, preferred first. A session request offers all of
 * them; whichever the wallet approves is the one its requests must name.
 */
export const chainToChainIds = (chain: Chain): string[] => {
  switch (chain) {
    case Chain.Avalanche:
      return [AVALANCHE_MAINNET_ID];
    case Chain.Aurora:
      return [AURORA_MAINNET_ID];
    case Chain.Base:
      return [BASE_MAINNET_ID];
    case Chain.BinanceSmartChain:
      return [BSC_MAINNET_ID];
    case Chain.Berachain:
      return [BERACHAIN_MAINNET_ID];
    case Chain.Monad:
      return [MONAD_MAINNET_ID];
    case Chain.Ethereum:
      return [ETHEREUM_MAINNET_ID];
    case Chain.THORChain:
      return [THORCHAIN_MAINNET_ID, THORCHAIN_LEGACY_ID];
    case Chain.Arbitrum:
      return [ARBITRUM_ONE_MAINNET_ID];
    case Chain.Optimism:
      return [OPTIMISM_MAINNET_ID];
    case Chain.Polygon:
      return [POLYGON_MAINNET_ID];
    case Chain.Maya:
      return [MAYACHAIN_MAINNET_ID];
    case Chain.Cosmos:
      return [COSMOS_HUB_MAINNET_ID];
    case Chain.Kujira:
      return [KUJIRA_MAINNET_ID];
    case Chain.Near: {
      // Use testnet if stagenet is enabled
      const { isStagenet } = USwapConfig.get("envs");
      return [isStagenet ? NEAR_TESTNET_ID : NEAR_MAINNET_ID];
    }
    case Chain.Tron:
      return [TRON_MAINNET_ID];
    case Chain.XLayer:
      return [XLAYER_MAINNET_ID];
    default:
      return [];
  }
};

export const chainToChainId = (chain: Chain) => chainToChainIds(chain)[0] || "";

// Accounts are CAIP-10 (`namespace:reference:address`). Compared whole, since a prefix match takes
// `eip155:10` (Optimism) or `eip155:137` (Polygon) for `eip155:1`.
const findAccount = (chain: Chain, accounts: string[]) => {
  const chainIds = chainToChainIds(chain);

  for (const chainId of chainIds) {
    const account = accounts.find((account) => account.slice(0, account.lastIndexOf(":")) === chainId);
    if (account) return { address: account.slice(account.lastIndexOf(":") + 1), chainId };
  }

  return undefined;
};

export const getAddressByChain = (chain: Chain, accounts: string[]) => findAccount(chain, accounts)?.address || "";

/** The CAIP-2 id the wallet approved the chain under — the one its requests have to carry. */
export const getSessionChainId = (chain: Chain, accounts: string[]) =>
  findAccount(chain, accounts)?.chainId || chainToChainId(chain);

export const getSessionAccounts = (session: SessionTypes.Struct) =>
  Object.values(session.namespaces).flatMap(({ accounts }) => accounts);

// A wallet may approve only some of the chains a session proposed. Reuse a live session that was
// proposed every chain asked for and approved at least one, so reconnecting with what was approved
// last time needs no scan; asking for a chain it was never proposed pairs a new session.
export function findReusableSession(sessions: SessionTypes.Struct[], chains: Chain[]) {
  const now = Date.now() / 1000;

  return sessions
    .filter((session) => session.expiry > now)
    .sort((a, b) => b.expiry - a.expiry)
    .find((session) => {
      const proposed = [
        ...Object.values(session.requiredNamespaces ?? {}),
        ...Object.values(session.optionalNamespaces ?? {}),
      ].flatMap((namespace) => namespace.chains ?? []);
      const accounts = getSessionAccounts(session);

      return (
        chains.every((chain) => chainToChainIds(chain).some((chainId) => proposed.includes(chainId))) &&
        chains.some((chain) => getAddressByChain(chain, accounts))
      );
    });
}

// Each chain with the newest live session the wallet approved it in: chains connected at different
// times sit in different sessions.
export function findRestorableSessions<T extends Chain>(sessions: SessionTypes.Struct[], chains: T[]) {
  const now = Date.now() / 1000;
  const live = sessions.filter((session) => session.expiry > now).sort((a, b) => b.expiry - a.expiry);

  return chains.flatMap((chain) => {
    const session = live.find((session) => getAddressByChain(chain, getSessionAccounts(session)));
    return session ? [{ chain, session }] : [];
  });
}

// WalletConnect's Verify API flags a `url` other than the page's own origin as a domain mismatch.
export function getMetadata(metadata: WalletconnectOptions["metadata"] = {}) {
  const origin = typeof window === "undefined" ? DEFAULT_APP_METADATA.url : window.location.origin;
  // An app that names itself does not borrow TCSwap's description and logo.
  const defaults = metadata.name ? { description: "", icons: [], name: metadata.name } : DEFAULT_APP_METADATA;
  return { ...defaults, ...metadata, url: metadata.url || origin };
}

/** The user closed the QR modal: a cancel rather than a failure. */
export function isWalletconnectDismissed(error: unknown) {
  // By message rather than `instanceof`, which fails when two copies of the helpers are installed.
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message.startsWith("wallet_walletconnect_modal_closed");
}
