/**
 * Modifications © 2025 Horizontal Systems.
 */

import { Chain, ChainToChainId, filterSupportedChains, USwapConfig, WalletOption } from "@tcswap/helpers";
import { createWallet, getWalletSupportedChains } from "@tcswap/wallet-core";

import { getWalletMethods } from "./signer";

export const coinbaseWallet = createWallet({
  connect: ({ addChain, walletType, supportedChains }) =>
    async function connectCoinbaseWallet(chains: Chain[]) {
      const { createCoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");

      const filteredChains = filterSupportedChains({ chains, supportedChains, walletType });

      const coinbaseConfig = USwapConfig.get("integrations").coinbase || { appName: "TCSwap Playground" };

      const coinbaseSdk = createCoinbaseWalletSDK({
        ...coinbaseConfig,
        appChainIds: filteredChains.map((chain) => Number(ChainToChainId[chain])),
      });

      await Promise.all(
        filteredChains.map(async (chain) => {
          const walletMethods = await getWalletMethods({ chain, coinbaseSdk });

          addChain({ ...walletMethods, chain, walletType });
        }),
      );

      return true;
    },
  name: "connectCoinbaseWallet",
  supportedChains: [
    Chain.Arbitrum,
    Chain.Avalanche,
    Chain.Base,
    Chain.BinanceSmartChain,
    Chain.Ethereum,
    Chain.Optimism,
    Chain.Polygon,
    Chain.XLayer,
  ],
  walletType: WalletOption.COINBASE_MOBILE,
});

export const COINBASE_SUPPORTED_CHAINS = getWalletSupportedChains(coinbaseWallet);
