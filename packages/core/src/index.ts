/**
 * Modifications © 2025 Horizontal Systems.
 */

import {
  ApproveMode,
  type ApproveReturnType,
  AssetValue,
  Chain,
  type ChainWallet,
  type ConditionalAssetValueReturn,
  CosmosChains,
  type EVMChain,
  EVMChains,
  type FeeOption,
  type GenericTransferParams,
  ProviderName as PluginNameEnum,
  type SwapParams,
  USwapConfig,
  type USwapConfigState,
  USwapError,
  UTXOChains,
  type WalletOption,
} from "@tcswap/helpers";
import type { EVMTransaction, QuoteResponseRoute } from "@tcswap/helpers/api";
import type { createPlugin } from "@tcswap/plugins";
import type { FullWallet } from "@tcswap/toolboxes";
import type { EVMCreateTransactionParams, EVMTransferParams } from "@tcswap/toolboxes/evm";
import type { createWallet } from "@tcswap/wallets";

export type USwapParams<P, W> = { config?: USwapConfigState; plugins?: P; wallets?: W };

export function USwap<
  Plugins extends ReturnType<typeof createPlugin>,
  Wallets extends ReturnType<typeof createWallet>,
>({
  config,
  plugins,
  wallets,
  getActiveWallet,
}: {
  config?: USwapConfigState;
  plugins?: Plugins;
  wallets?: Wallets;
  getActiveWallet?: () => WalletOption | undefined;
} = {}) {
  if (config) {
    USwapConfig.set(config);
  }

  type PluginName = keyof Plugins;
  const connectedWalletsByChain = {} as FullWallet;
  const connectedWalletsByWallet = new Map<WalletOption, Map<Chain, FullWallet[Chain]>>();
  type ConnectedChains = keyof typeof connectedWalletsByChain;
  type ActionType = "transfer" | "approve" | "swap";

  type ActionParams<P extends PluginName> = {
    transfer: EVMTransferParams | (GenericTransferParams & { sender?: string });
    approve: { assetValue: AssetValue; contractAddress: string; feeOptionKey?: FeeOption };
    swap: SwapParams<P, QuoteResponseRoute> & { assetValue: AssetValue };
  };

  const availablePlugins = Object.entries(plugins || {}).reduce(
    (acc, [pluginName, plugin]) => {
      const methods = plugin({ getWallet: getSelectedWallet });

      acc[pluginName as PluginName] = methods as ReturnType<Plugins[keyof Plugins]>;
      return acc;
    },
    {} as { [key in PluginName]: ReturnType<Plugins[key]> },
  );

  const connectWalletMethods = Object.entries(wallets || {}).reduce(
    (acc, [walletName, wallet]) => {
      const connectWallet = wallet.connectWallet({ addChain });

      acc[walletName as keyof Wallets] = connectWallet as ReturnType<Wallets[keyof Wallets]["connectWallet"]>;
      return acc;
    },
    {} as {
      [key in keyof Wallets]: ReturnType<Wallets[key]["connectWallet"]>;
    },
  );

  function getUSwapPlugin<T extends PluginName>(pluginName?: T) {
    const pluginByName = pluginName && availablePlugins[pluginName];
    const pluginByProvider = Object.values(availablePlugins).find((plugin) =>
      plugin.supportedUSwapProviders?.includes(pluginName),
    );
    const plugin = pluginByName || pluginByProvider;

    if (!plugin) {
      throw new USwapError("core_plugin_not_found");
    }

    return plugin as ReturnType<Plugins[T]>;
  }

  function addChain<T extends Chain>(connectWallet: Omit<ChainWallet<T>, "balance"> & { balance?: AssetValue[] }) {
    const currentWallet = getWalletByChain(connectWallet.chain);

    // Fields carry over only from the same wallet: another's `disconnect` would end that wallet's session.
    // The balance carries over only from the same address, as a wallet may have switched accounts.
    const previous = currentWallet?.walletType === connectWallet.walletType ? currentWallet : undefined;
    const previousBalance = previous?.address === connectWallet.address ? previous?.balance : undefined;
    const balance = connectWallet?.balance || previousBalance || [AssetValue.from({ chain: connectWallet.chain })];
    const wallet = { ...previous, ...connectWallet, balance };
    connectedWalletsByChain[connectWallet.chain] = wallet as FullWallet[T];

    const walletOption = connectWallet.walletType as WalletOption;
    const chainMap = connectedWalletsByWallet.get(walletOption) ?? new Map<Chain, any>();
    // Re-inserted so the map runs from the least to the most recently connected wallet.
    connectedWalletsByWallet.delete(walletOption);
    connectedWalletsByWallet.set(walletOption, chainMap);

    chainMap.set(connectWallet.chain, wallet as FullWallet[T]);

    return wallet;
  }

  function approve<T extends ApproveMode>({
    assetValue,
    type = "checkOnly" as T,
    contractAddress: spenderAddress,
  }: {
    type: T;
    assetValue: AssetValue;
    contractAddress: string | PluginName;
  }) {
    const plugin = availablePlugins[spenderAddress];

    if (plugin) {
      if (type === ApproveMode.CheckOnly && "isAssetValueApproved" in plugin) {
        // @ts-expect-error TODO: add optional approve for plugin
        return plugin.isAssetValueApproved({ assetValue }) as ApproveReturnType<T>;
      }
      if (type === ApproveMode.Approve && "approveAssetValue" in plugin) {
        // @ts-expect-error TODO: add optional approve for plugin
        return plugin.approveAssetValue({ assetValue }) as ApproveReturnType<T>;
      }

      throw new USwapError({
        errorKey: "core_approve_asset_target_invalid",
        info: { message: `Target ${String(spenderAddress)} cannot be used for approve operation` },
      });
    }

    const chain = assetValue.chain as EVMChain;
    const isEVMChain = EVMChains.includes(chain);
    const isNativeEVM = isEVMChain && assetValue.isGasAsset;

    if (isNativeEVM || !isEVMChain || assetValue.isSynthetic) {
      return Promise.resolve(type === "checkOnly" ? true : "approved") as ApproveReturnType<T>;
    }

    const wallet = getWalletByChain(chain);
    const walletAction = type === "checkOnly" ? wallet.isApproved : wallet.approve;
    if (!walletAction) throw new USwapError("core_wallet_connection_not_found");

    if (!(assetValue.address && wallet.address && typeof spenderAddress === "string")) {
      throw new USwapError("core_approve_asset_address_or_from_not_found");
    }

    return walletAction({
      amount: assetValue.getBaseValue("bigint"),
      assetAddress: assetValue.address,
      from: wallet.address,
      spenderAddress,
    }) as ApproveReturnType<T>;
  }

  /**
   * @Public
   */
  function getWallet<T extends Chain>(walletOption: WalletOption, chain: T): FullWallet[T] {
    return connectedWalletsByWallet.get(walletOption)?.get(chain) as FullWallet[T];
  }

  function getWalletByChain<T extends ConnectedChains>(chain: T) {
    return connectedWalletsByChain[chain];
  }

  function getSelectedWallet<T extends ConnectedChains>(chain: T): FullWallet[T] {
    const selected = getActiveWallet?.();
    if (!selected) {
      throw new Error(`Unknown connected chain: ${chain}`);
    }

    return getWallet(selected, chain) as FullWallet[T];
  }

  function getAllWallets() {
    return { ...connectedWalletsByChain };
  }

  function getAddress<T extends Chain>(chain: T) {
    return getWalletByChain(chain)?.address || "";
  }

  function approveAssetValue(assetValue: AssetValue, contractAddress: string | PluginName) {
    return approve({ assetValue, contractAddress, type: ApproveMode.Approve });
  }

  function isAssetValueApproved(assetValue: AssetValue, contractAddress: string | PluginName) {
    return approve({ assetValue, contractAddress, type: ApproveMode.CheckOnly });
  }

  function disconnectChain<T extends Chain>(chain: T) {
    const wallet = getWalletByChain(chain);
    if (wallet?.walletType) {
      const chainMap = connectedWalletsByWallet.get(wallet.walletType as WalletOption);
      if (chainMap) {
        chainMap.delete(chain);
        if (chainMap.size === 0) {
          connectedWalletsByWallet.delete(wallet.walletType as WalletOption);
        }
      }
    }

    endSession(wallet);
    delete connectedWalletsByChain[chain];
  }

  // A wallet's `disconnect` may throw or reject (a provider without `wallet_revokePermissions`); that
  // must not stop the rest of a disconnect.
  function endSession(wallet?: { disconnect?: () => unknown }) {
    try {
      Promise.resolve(wallet?.disconnect?.()).catch(() => undefined);
    } catch {
      // Already disconnected as far as this SDK goes.
    }
  }

  /**
   * Disconnects every chain of one wallet, or only `chains`, including chains another wallet has since taken
   * over: their slot stays with that wallet, but this one's session still ends.
   */
  function disconnectWallet(walletOption: WalletOption, chains?: Chain[]) {
    const chainMap = connectedWalletsByWallet.get(walletOption);
    if (!chainMap) return;

    const disconnected = [...chainMap].filter(([chain]) => !chains || chains.includes(chain));
    for (const [chain] of disconnected) chainMap.delete(chain);
    if (chainMap.size === 0) connectedWalletsByWallet.delete(walletOption);

    for (const [chain, wallet] of disconnected) {
      if (connectedWalletsByChain[chain as ConnectedChains]?.walletType === walletOption) {
        // Hand the chain back to the most recently connected wallet still on it, if any.
        const other = [...connectedWalletsByWallet.values()]
          .reverse()
          .find((wallets) => wallets.has(chain))
          ?.get(chain);
        if (other) (connectedWalletsByChain as Record<Chain, unknown>)[chain] = other;
        else delete connectedWalletsByChain[chain as ConnectedChains];
      }

      endSession(wallet);
    }
  }

  // Wallet by wallet: a chain's slot holds only the last wallet connected on it, and the others' sessions on
  // that chain must end too.
  function disconnectAll() {
    for (const walletOption of [...connectedWalletsByWallet.keys()]) {
      disconnectWallet(walletOption);
    }
    for (const chain of Object.keys(connectedWalletsByChain) as (keyof typeof connectedWalletsByChain)[]) {
      disconnectChain(chain);
    }
  }

  function getBalance<T extends Chain, R extends boolean>(chain: T, refresh?: R): ConditionalAssetValueReturn<R> {
    return (
      refresh ? getWalletWithBalance(chain).then(({ balance }) => balance) : getWalletByChain(chain)?.balance || []
    ) as ConditionalAssetValueReturn<R>;
  }

  async function getWalletWithBalance<T extends Chain>(chain: T, scamFilter = true) {
    const wallet = getWalletByChain(chain);
    if (!wallet) {
      throw new USwapError("core_wallet_connection_not_found");
    }
    const defaultBalance = [AssetValue.from({ chain })];
    wallet.balance = defaultBalance;

    if ("getBalance" in wallet) {
      const balance = await wallet.getBalance(wallet.address, scamFilter);
      wallet.balance = balance;
    }

    return wallet;
  }

  function swap<T extends PluginName>({ route, pluginName, ...rest }: SwapParams<T, QuoteResponseRoute>) {
    const plugin = getUSwapPlugin(pluginName || route.providers[0]);

    if ("swap" in plugin) {
      // @ts-expect-error TODO: fix this
      return plugin.swap({ ...rest, route });
    }

    throw new USwapError("core_plugin_swap_not_found");
  }

  function transfer({ assetValue, ...params }: GenericTransferParams | EVMTransferParams) {
    const chain = assetValue.chain;
    if ([Chain.Radix].includes(chain) || !getWalletByChain(chain)) {
      throw new USwapError("core_wallet_connection_not_found");
    }
    const wallet = getWalletByChain(chain as Exclude<Chain, typeof Chain.Radix | typeof Chain.Near>);

    // we need to simplify this to one object params
    return wallet.transfer({ ...params, assetValue });
  }

  function signMessage({ chain, message }: { chain: Chain; message: string }) {
    const wallet = getWalletByChain(chain);
    if (!wallet) throw new USwapError("core_wallet_connection_not_found");

    if ("signMessage" in wallet) {
      return wallet.signMessage?.(message);
    }

    throw new USwapError({
      errorKey: "core_wallet_sign_message_not_supported",
      info: { chain, wallet: wallet.walletType },
    });
  }

  async function verifyMessage({
    address,
    chain,
    message,
    signature,
  }: {
    chain: Chain;
    signature: string;
    message: string;
    address: string;
  }) {
    if (chain !== Chain.THORChain) {
      throw new USwapError({ errorKey: "core_verify_message_not_supported", info: { chain } });
    }

    const { getCosmosToolbox } = await import("@tcswap/toolboxes/cosmos");
    const toolbox = await getCosmosToolbox(chain);

    return toolbox.verifySignature({ address, message, signature });
  }

  async function estimateTransactionFee<P extends PluginName, T extends ActionType>({
    type,
    feeOptionKey,
    params,
  }: {
    type: T;
    params: ActionParams<P>[T];
    feeOptionKey: FeeOption;
  }): Promise<AssetValue | undefined> {
    const { assetValue } = params;
    const { chain } = assetValue;

    if (!getWalletByChain(chain as Chain)) throw new USwapError("core_wallet_connection_not_found");

    const baseValue = AssetValue.from({ chain });
    const { match } = await import("ts-pattern");

    return match(chain as Chain)
      .returnType<Promise<AssetValue | undefined> | AssetValue | undefined>()
      .with(...EVMChains, (chain) => {
        const { address, ...wallet } = getWalletByChain(chain);

        const tx = match(type as ActionType)
          .with("transfer", () => wallet.createTransferTx(params as EVMCreateTransactionParams))
          .with("approve", (_t) => {
            const { contractAddress } = params as ActionParams<P>[typeof _t];

            return wallet.createApprovalTx({
              amount: assetValue.getBaseValue("bigint"),
              assetAddress: assetValue.address as string,
              from: address,
              spenderAddress: contractAddress,
            });
          })
          .with("swap", (_t) => {
            const {
              route: {
                providers: [plugin],
                tx,
              },
            } = params as ActionParams<P>[typeof _t];

            if (plugin && [PluginNameEnum.CHAINFLIP, PluginNameEnum.CHAINFLIP_STREAMING].includes(plugin)) {
              return wallet.createTransferTx({ assetValue, recipient: address, sender: address });
            }

            const evmTx = tx as EVMTransaction;

            return { ...evmTx, value: BigInt(evmTx.value) };
          })
          .otherwise(() => undefined);

        if (!tx) return baseValue;

        return wallet.estimateTransactionFee({ ...tx, chain, feeOption: feeOptionKey });
      })
      .with(...UTXOChains, (chain) => {
        const { address, ...wallet } = getWalletByChain(chain);
        return wallet.estimateTransactionFee({ ...params, feeOptionKey, recipient: address, sender: address });
      })
      .with(...CosmosChains, async () => {
        const { estimateTransactionFee } = await import("@tcswap/toolboxes/cosmos");
        return estimateTransactionFee(params);
      })
      .with(Chain.Polkadot, (chain) => {
        const wallet = getWalletByChain(chain);
        return wallet.estimateTransactionFee({ ...params, recipient: wallet.address });
      })
      .with(Chain.Tron, (chain) => {
        const { address, ...wallet } = getWalletByChain(chain);
        return wallet.estimateTransactionFee({ ...params, recipient: address, sender: address });
      })
      .with(Chain.Ripple, (chain) => getWalletByChain(chain).estimateTransactionFee())
      .with(Chain.Ton, (chain) => getWalletByChain(chain).estimateTransactionFee())
      .with(Chain.Cardano, (chain) => getWalletByChain(chain).estimateTransactionFee())
      .with(Chain.Sui, (chain) => getWalletByChain(chain).estimateTransactionFee())
      .otherwise(async () => baseValue);
  }

  return {
    ...availablePlugins,
    ...connectWalletMethods,

    approveAssetValue,
    disconnectAll,
    disconnectChain,
    disconnectWallet,
    estimateTransactionFee,
    getAddress,
    getAllWallets,
    getBalance,
    getWallet,
    getWalletByChain,
    getWalletWithBalance,
    isAssetValueApproved,
    signMessage,
    swap,
    transfer,
    verifyMessage,
  };
}

export * from "@tcswap/helpers";
