import {
  type AddChainType,
  Chain,
  type ErrorKeys,
  type EVMChain,
  EVMChains,
  USwapError,
  type WalletOption,
} from "@tcswap/helpers";
import type { SolanaProvider } from "@tcswap/toolboxes/solana";
import type { Eip1193Provider } from "ethers";

/**
 * The connect choreography shared by multi-ecosystem extensions (Brave, Binance): EVM chains share
 * one provider, so they connect serially and only the first opens the wallet's approval, while the
 * other ecosystems' providers run alongside. A chain the user declined, or one the wallet does not
 * hold, must not cost them the rest — only connecting nothing at all throws.
 */
export async function connectChainProviders<SupportedChain extends Chain>({
  addChain,
  chains,
  getWalletMethods,
  walletName,
  walletType,
}: {
  addChain: AddChainType;
  chains: SupportedChain[];
  getWalletMethods: (chain: SupportedChain) => Promise<{ address: string } & { [key: string]: any }>;
  walletName: string;
  walletType: WalletOption;
}) {
  const failures: unknown[] = [];

  const connectChain = async (chain: SupportedChain) => {
    try {
      const { address, ...walletMethods } = await getWalletMethods(chain);

      addChain({ ...walletMethods, address, chain, walletType });
    } catch (error) {
      failures.push(error);
      console.warn(`${walletName} failed to connect ${chain}:`, error);
    }
  };

  const evmChains = chains.filter((chain) => EVMChains.includes(chain as EVMChain));
  const otherChains = chains.filter((chain) => !EVMChains.includes(chain as EVMChain));

  const connectEVMChains = async () => {
    for (const chain of evmChains) {
      await connectChain(chain);
    }
  };

  await Promise.all([connectEVMChains(), ...otherChains.map(connectChain)]);

  if (failures.length === chains.length) throw failures[0];

  return true;
}

/**
 * EVM methods for an extension whose one EIP-1193 provider serves every EVM chain. The permission
 * covers them all, so `disconnect` revokes it only when the wallet's last EVM chain disconnects —
 * and a build without `wallet_revokePermissions` must not throw.
 */
export function createEVMWalletMethods({
  getProvider,
  notFoundError,
}: {
  getProvider: () => Eip1193Provider | undefined | Promise<Eip1193Provider | undefined>;
  notFoundError: ErrorKeys;
}) {
  const connectedEVMChains = new Set<EVMChain>();

  return async function getEVMWalletMethods(chain: EVMChain) {
    const walletProvider = await getProvider();
    if (!walletProvider) throw new USwapError(notFoundError, { chain });

    const { BrowserProvider } = await import("ethers");
    const { getWeb3WalletMethods } = await import("../evm-extensions");

    const provider = new BrowserProvider(walletProvider, "any");

    // `eth_accounts` answers silently when the site is already approved and the wallet unlocked;
    // `eth_requestAccounts` is the call that opens the wallet.
    const approved: string[] = await provider.send("eth_accounts", []);
    if (approved.length === 0) await provider.send("eth_requestAccounts", []);

    const signer = await provider.getSigner();
    const address = await signer.getAddress();

    const walletMethods = await getWeb3WalletMethods({ address, chain, provider, walletProvider });

    connectedEVMChains.add(chain);
    const disconnect = () => {
      connectedEVMChains.delete(chain);
      if (connectedEVMChains.size > 0) return Promise.resolve();

      return provider.send("wallet_revokePermissions", [{ eth_accounts: {} }]).then(
        () => undefined,
        () => undefined,
      );
    };

    return { ...walletMethods, address, disconnect };
  };
}

/** Connects a Phantom-shaped Solana provider: silently for an already-approved site, visibly otherwise. */
export async function connectSolanaProvider({
  noAddressError,
  notFoundError,
  provider,
}: {
  noAddressError: ErrorKeys;
  notFoundError: ErrorKeys;
  provider: SolanaProvider | undefined;
}) {
  if (!provider) throw new USwapError(notFoundError, { chain: Chain.Solana });

  const { getSolanaToolbox } = await import("@tcswap/toolboxes/solana");

  // `onlyIfTrusted` reconnects an already-approved site silently and rejects on a new one, which is
  // when the visible connect is the right thing. The wallet answers with the account and parks it on
  // the provider; some builds only do the latter, so neither result can be destructured.
  const connection = await provider.connect({ onlyIfTrusted: true }).catch(() => provider.connect());
  const address = (connection?.publicKey || provider.publicKey)?.toString();
  if (!address) throw new USwapError(noAddressError, { chain: Chain.Solana });

  const toolbox = await getSolanaToolbox({ signer: provider });
  const disconnect = () => provider.disconnect().catch(() => undefined);

  return { ...toolbox, address, disconnect };
}
