/**
 * Modifications © 2025 Horizontal Systems.
 */

import type { AccountData, AminoSignResponse, OfflineAminoSigner, StdSignDoc } from "@cosmjs/amino";
import type { Transaction } from "@near-js/transactions";
import { Chain, filterSupportedChains, getRPCUrl, USwapConfig, USwapError, WalletOption } from "@tcswap/helpers";
import type { NearSigner } from "@tcswap/toolboxes/near";
import type { TronSignedTransaction, TronSigner, TronTransaction } from "@tcswap/toolboxes/tron";
import { createWallet, getWalletSupportedChains } from "@tcswap/wallet-core";
import type { WalletConnectModal } from "@walletconnect/modal";
import type { SignClient } from "@walletconnect/sign-client";
import type { SessionTypes } from "@walletconnect/types";
import {
  DEFAULT_APP_METADATA,
  DEFAULT_COSMOS_METHODS,
  DEFAULT_LOGGER,
  DEFAULT_NEAR_METHODS,
  DEFAULT_RELAY_URL,
  DEFAULT_TRON_METHODS,
} from "./constants";
import { getEVMSigner } from "./evmSigner";
import {
  chainToChainIds,
  findReusableSession,
  getAddressByChain,
  getSessionAccounts,
  getSessionChainId,
} from "./helpers";
import { getNamespaces } from "./namespaces";
import type { WalletconnectOptions } from "./types";

export * from "./constants";
export * from "./types";

export const walletconnectWallet = createWallet({
  connect: ({ addChain, supportedChains, walletType }) =>
    async function connectWalletconnect(chains: Chain[], walletconnectOptions?: WalletconnectOptions) {
      const filteredChains = filterSupportedChains({ chains, supportedChains, walletType });
      const { walletConnectProjectId } = USwapConfig.get("apiKeys");

      if (!walletConnectProjectId) {
        throw new USwapError("wallet_walletconnect_project_id_not_specified");
      }

      const walletconnect = await getWalletconnect(filteredChains, walletConnectProjectId, walletconnectOptions);

      // The proposal asks for every chain as optional, so the wallet may approve only some of them.
      const approvedChains = filteredChains.filter((chain) => getAddressByChain(chain, walletconnect.accounts));
      if (approvedChains.length === 0) {
        await walletconnect.disconnect();
        throw new USwapError("wallet_walletconnect_chain_not_supported", { chains: filteredChains });
      }

      await Promise.all(
        approvedChains.map(async (chain) => {
          const address = getAddressByChain(chain, walletconnect.accounts);
          const toolbox = await getToolbox({ address, chain, walletconnect });

          addChain({
            ...toolbox,
            address,
            chain,
            disconnect: walletconnect.disconnect,
            walletType: WalletOption.WALLETCONNECT,
          });
        }),
      );

      return true;
    },
  name: "connectWalletconnect",
  supportedChains: [
    Chain.Arbitrum,
    Chain.Aurora,
    Chain.Avalanche,
    Chain.Base,
    Chain.Berachain,
    Chain.BinanceSmartChain,
    Chain.Cosmos,
    Chain.Ethereum,
    Chain.Kujira,
    Chain.Maya,
    Chain.Monad,
    Chain.Near,
    Chain.Optimism,
    Chain.Polygon,
    Chain.THORChain,
    Chain.Tron,
    Chain.XLayer,
  ],
  walletType: WalletOption.WALLETCONNECT,
});

export const WC_SUPPORTED_CHAINS = getWalletSupportedChains(walletconnectWallet);
export type Walletconnect = Awaited<ReturnType<typeof getWalletconnect>>;

async function getToolbox<T extends (typeof WC_SUPPORTED_CHAINS)[number]>({
  chain,
  walletconnect,
  address,
}: {
  walletconnect: Walletconnect;
  chain: T;
  address: string;
}) {
  const { client, session, accounts } = walletconnect;
  const chainId = getSessionChainId(chain, accounts);

  switch (chain) {
    case Chain.Arbitrum:
    case Chain.Aurora:
    case Chain.Avalanche:
    case Chain.Base:
    case Chain.Berachain:
    case Chain.BinanceSmartChain:
    case Chain.Ethereum:
    case Chain.Monad:
    case Chain.Optimism:
    case Chain.Polygon:
    case Chain.XLayer: {
      const { getProvider, getEvmToolbox } = await import("@tcswap/toolboxes/evm");

      const provider = await getProvider(chain);
      const signer = await getEVMSigner({ chain, provider, walletconnect });
      const toolbox = await getEvmToolbox(chain, { provider, signer });

      return toolbox;
    }

    case Chain.Cosmos:
    case Chain.Kujira:
    case Chain.Maya:
    case Chain.THORChain: {
      const { getCosmosToolbox } = await import("@tcswap/toolboxes/cosmos");

      const signer = getCosmosSigner({ address, chain, chainId, walletconnect });
      const toolbox = await getCosmosToolbox(chain, { signer });

      return toolbox;
    }

    case Chain.Near: {
      const { getNearToolbox } = await import("@tcswap/toolboxes/near");

      // Create a NEAR signer that uses WalletConnect
      const signer = {
        getAddress() {
          return Promise.resolve(address);
        },
        getPublicKey() {
          // WalletConnect NEAR doesn't expose public key directly
          return Promise.reject(
            new USwapError("wallet_walletconnect_method_not_supported", { method: "getPublicKey" }),
          );
        },

        signDelegateAction(_delegateAction: any) {
          return Promise.reject(
            new USwapError("wallet_walletconnect_method_not_supported", { method: "signDelegateAction" }),
          );
        },

        signNep413Message(
          _message: string,
          _accountId: string,
          _recipient: string,
          _nonce: Uint8Array,
          _callbackUrl?: string,
        ) {
          // WalletConnect NEAR spec doesn't include NEP-413 message signing
          return Promise.reject(
            new USwapError("wallet_walletconnect_method_not_supported", { method: "signNep413Message" }),
          );
        },

        async signTransaction(transaction: Transaction) {
          // WalletConnect signs and sends in one operation
          const result = await client.request({
            chainId,
            request: { method: DEFAULT_NEAR_METHODS.NEAR_SIGN_AND_SEND_TRANSACTION, params: { transaction } },
            topic: session.topic,
          });
          // Return dummy hash and result
          return [new Uint8Array(32), result];
        },
      } as NearSigner;

      const toolbox = await getNearToolbox({ signer });
      return toolbox;
    }

    case Chain.Tron: {
      const { createTronToolbox } = await import("@tcswap/toolboxes/tron");

      // Create a Tron signer that uses WalletConnect
      const signer: TronSigner = {
        getAddress() {
          return Promise.resolve(address);
        },

        async signTransaction(transaction: TronTransaction) {
          const response = await client.request<TronSignedTransaction | { result: TronSignedTransaction }>({
            chainId,
            request: { method: DEFAULT_TRON_METHODS.TRON_SIGN_TRANSACTION, params: { address, transaction } },
            topic: session.topic,
          });

          // Some wallets wrap the signed transaction in `result`.
          return "txID" in response ? response : response.result;
        },
      };

      const toolbox = await createTronToolbox({ signer });
      return toolbox;
    }

    default:
      throw new USwapError({
        errorKey: "wallet_chain_not_supported",
        info: { chain, wallet: WalletOption.WALLETCONNECT },
      });
  }
}

/**
 * An amino signer backed by `cosmos_signAmino`, so the cosmos toolboxes build, sign and broadcast as
 * they do for Keplr. The public key comes from `cosmos_getAccounts`, or from the chain when the
 * wallet does not answer that.
 */
function getCosmosSigner({
  address,
  chain,
  chainId,
  walletconnect: { client, session },
}: {
  address: string;
  chain: Chain;
  chainId: string;
  walletconnect: Walletconnect;
}): OfflineAminoSigner {
  let account: Promise<AccountData> | undefined;

  async function loadAccount(): Promise<AccountData> {
    const { fromBase64 } = await import("@tcswap/toolboxes/cosmos");

    try {
      const accounts = await client.request<{ address: string; algo: string; pubkey: string }[]>({
        chainId,
        request: { method: DEFAULT_COSMOS_METHODS.COSMOS_GET_ACCOUNTS, params: {} },
        topic: session.topic,
      });
      const match = accounts?.find((a) => a.address === address);
      if (match?.pubkey) return { address, algo: "secp256k1", pubkey: fromBase64(match.pubkey) };
    } catch {
      // Not every wallet implements cosmos_getAccounts; fall back to the chain below.
    }

    const { createStargateClient } = await import("@tcswap/toolboxes/cosmos");
    const stargate = await createStargateClient(await getRPCUrl(chain));
    const pubkey = (await stargate.getAccount(address))?.pubkey?.value;

    if (!pubkey) {
      // A fresh account has no public key on chain until its first transaction.
      throw new USwapError({ errorKey: "wallet_missing_params", info: { address, chain, pubkey } });
    }

    return { address, algo: "secp256k1", pubkey: fromBase64(pubkey) };
  }

  function getAccount() {
    account ??= loadAccount().catch((error) => {
      account = undefined;
      throw error;
    });
    return account;
  }

  return {
    getAccounts: async () => [await getAccount()],

    async signAmino(signerAddress: string, signDoc: StdSignDoc): Promise<AminoSignResponse> {
      const response = await client.request<Partial<AminoSignResponse> & { signature: any }>({
        chainId,
        request: { method: DEFAULT_COSMOS_METHODS.COSMOS_SIGN_AMINO, params: { signDoc, signerAddress } },
        topic: session.topic,
      });

      // Wallets answer with the spec's `{ signed, signature: { pub_key, signature } }`, or with the
      // bare base64 signature.
      if (typeof response.signature === "string") {
        const amino = await import("@cosmjs/amino");
        const encodeSecp256k1Pubkey = amino.encodeSecp256k1Pubkey ?? (amino as any).default?.encodeSecp256k1Pubkey;
        const { pubkey } = await getAccount();
        return {
          signature: { pub_key: encodeSecp256k1Pubkey(pubkey), signature: response.signature },
          signed: response.signed || signDoc,
        };
      }

      return { signature: response.signature, signed: response.signed || signDoc };
    },
  };
}

type SignClientInstance = Awaited<ReturnType<typeof SignClient.init>>;

// One client and one modal per page: every `SignClient.init` opens its own relay socket and storage,
// and WalletConnect warns when it is initialised again.
let clientPromise: Promise<SignClientInstance> | undefined;
let modalInstance: WalletConnectModal | undefined;

function getSignClient(projectId: string, { restoreOnly: _, ...options }: WalletconnectOptions = {}) {
  clientPromise ??= import("@walletconnect/sign-client")
    .then(({ SignClient }) =>
      SignClient.init({
        logger: DEFAULT_LOGGER,
        relayUrl: DEFAULT_RELAY_URL,
        ...options,
        metadata: options.metadata || DEFAULT_APP_METADATA,
        projectId,
      }),
    )
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });

  return clientPromise;
}

async function getModal(projectId: string) {
  if (!modalInstance) {
    const { WalletConnectModal } = await import("@walletconnect/modal");
    modalInstance = new WalletConnectModal({ projectId });
  }

  return modalInstance;
}

/** Shows the QR code until the wallet approves, rejects, or the user closes the modal. */
async function pair(client: SignClientInstance, projectId: string, chains: Chain[]) {
  const { uri, approval } = await client.connect({
    optionalNamespaces: getNamespaces(chains.flatMap(chainToChainIds)),
  });

  if (!uri) {
    throw new USwapError("wallet_walletconnect_connection_not_established");
  }

  const modal = await getModal(projectId);

  return new Promise<SessionTypes.Struct>((resolve, reject) => {
    let settled = false;

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      modal.closeModal();
      outcome();
    };

    // Without this the caller waits until the proposal expires, minutes after the modal is gone.
    const unsubscribe = modal.subscribeModal(({ open }) => {
      if (!open) {
        settle(() => reject(new USwapError("wallet_walletconnect_connection_not_established", { reason: "closed" })));
      }
    });

    approval().then(
      (session) => settle(() => resolve(session)),
      (error) => settle(() => reject(new USwapError("wallet_walletconnect_connection_not_established", error))),
    );

    modal.openModal({ uri }).catch((error) => settle(() => reject(error)));
  });
}

async function getWalletconnect(chains: Chain[], projectId: string, walletconnectOptions?: WalletconnectOptions) {
  const client = await getSignClient(projectId, walletconnectOptions).catch((error) => {
    throw new USwapError("wallet_walletconnect_connection_not_established", error);
  });

  let session = findReusableSession(client.session.getAll(), chains);

  if (!session) {
    if (walletconnectOptions?.restoreOnly) {
      throw new USwapError("wallet_walletconnect_connection_not_established", { reason: "no_session" });
    }

    // Earlier sessions stay: chains connected through them still sign with their topic. Each ends
    // with its chains' `disconnect`, or expires.
    session = await pair(client, projectId, chains);
  }

  const { topic } = session;
  const accounts = getSessionAccounts(session);

  // Every connected chain shares this; only the first call reaches the wallet.
  const disconnect = async () => {
    if (!client.session.getAll().some((s) => s.topic === topic)) return;
    await client.disconnect({ reason: { code: 6000, message: "User disconnected" }, topic }).catch(() => undefined);
  };

  return { accounts, client, disconnect, session };
}
