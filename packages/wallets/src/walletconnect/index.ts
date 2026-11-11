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
import type { SessionTypes } from "@walletconnect/types";
import {
  DEFAULT_COSMOS_METHODS,
  DEFAULT_LOGGER,
  DEFAULT_NEAR_METHODS,
  DEFAULT_RELAY_URL,
  DEFAULT_TRON_METHODS,
} from "./constants";
import { getEVMSigner } from "./evmSigner";
import {
  chainToChainIds,
  findRestorableSessions,
  findReusableSession,
  getAddressByChain,
  getMetadata,
  getSessionAccounts,
  getSessionChainId,
} from "./helpers";
import { getNamespaces } from "./namespaces";
import {
  bindChain,
  disconnectChain,
  endSession,
  endUnusedSessions,
  isEnding,
  onSessionEnded,
  type SignClientInstance,
  trackSetup,
} from "./sessions";
import { targetWalletPresentation } from "./targetWallet";
import type { WalletconnectOptions, WalletconnectTarget } from "./types";

export * from "./constants";
export { isWalletconnectDismissed } from "./helpers";
export { onWalletconnectDisconnect } from "./sessions";
export { oathWalletconnectTarget } from "./targetWallet";
export * from "./types";

export const walletconnectWallet = createWallet({
  connect: ({ addChain, supportedChains, walletType }) =>
    async function connectWalletconnect(chains: Chain[], walletconnectOptions?: WalletconnectOptions) {
      const filteredChains = filterSupportedChains({ chains, supportedChains, walletType });
      const { walletConnectProjectId } = USwapConfig.get("apiKeys");

      if (!walletConnectProjectId) {
        throw new USwapError("wallet_walletconnect_project_id_not_specified");
      }

      const restoreOnly = !!walletconnectOptions?.restoreOnly;
      const { approved, client, setUp, superseded } = await enqueue(async () => {
        const found = await getWalletconnects(filteredChains, walletConnectProjectId, walletconnectOptions);
        // In use until set up, so another connect ending the sessions it has no chain on leaves these be.
        const topics = found.approved.map(({ walletconnect }) => walletconnect.session.topic);
        return { ...found, setUp: trackSetup(topics) };
      });

      const added = await Promise.allSettled(
        approved.map(async ({ chain, walletconnect }) => {
          const { client, session } = walletconnect;
          const address = getAddressByChain(chain, walletconnect.accounts);
          const toolbox = await getToolbox({ address, chain, walletconnect });

          // Ended while the chain was set up: by the wallet while the page was closed, say, which the relay
          // delivers only once it has reconnected, or by another connect.
          if (!client.session.keys.includes(session.topic) || isEnding(session.topic)) {
            const info = { reason: "The wallet ended the session" };
            throw new USwapError({ errorKey: "wallet_walletconnect_connection_not_established", info });
          }

          addChain({
            ...toolbox,
            address,
            chain,
            disconnect: () => disconnectChain(client, chain, session.topic),
            walletType: WalletOption.WALLETCONNECT,
          });
          // Bound as it is added, so the wallet ending the session from now on finds the chain. The session it
          // signed with until now is taken here too, not before the setup, which another connect may outrun.
          return bindChain(chain, session.topic);
        }),
      );
      setUp();

      // Sessions no chain signs with any more are ended: those the chains replaced and, when some chain connected,
      // those superseded. So is one no chain could be set up with, but not on a restore: failing here (a chunk that
      // did not load, say) is no reason to drop a session the user approved.
      const connected = added.some((result) => result.status === "fulfilled");
      const replaced = added.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const sessionTopics = restoreOnly ? [] : approved.map(({ walletconnect }) => walletconnect.session.topic);
      endUnusedSessions(client, [...replaced, ...sessionTopics, ...(connected ? superseded : [])]);

      // A chain that failed to set up is left out like one the wallet did not approve, unless every chain failed.
      const failures = approved.flatMap(({ chain }, index) => {
        const result = added[index];
        return result?.status === "rejected" ? [{ chain, reason: result.reason }] : [];
      });
      if (!connected) throw failures[0]?.reason;

      for (const { chain, reason } of failures) {
        console.warn(`WalletConnect: ${chain} was not connected`, reason);
      }

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

/**
 * Loads WalletConnect, connects to its relay and readies the QR modal ahead of a connect, so pressing
 * connect opens the modal at once and its QR code follows a single relay round trip later. Pass the options
 * the connect will use: the client keeps the first ones it is created with.
 */
export function preloadWalletconnect(walletconnectOptions?: WalletconnectOptions) {
  const { walletConnectProjectId } = USwapConfig.get("apiKeys");
  if (!walletConnectProjectId || typeof window === "undefined") return;

  getSignClient(walletConnectProjectId, walletconnectOptions)
    // The client opens its relay socket only on its first request, which costs that request ~0.5s.
    // Not in the client's types, so called only where it exists.
    .then((client) =>
      (client.core.relayer as { toEstablishConnection?: () => Promise<void> }).toEstablishConnection?.(),
    )
    .catch(() => undefined);
  getModal(walletConnectProjectId).catch(() => undefined);
}

// Finding or pairing a session runs one at a time: pairings share one QR modal, and one closing it
// would cancel the other; two lookups at once would each miss the other's session and pair twice.
let connectQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>) {
  const run = connectQueue.then(task);
  connectQueue = run.catch(() => undefined);
  return run;
}

export const WC_SUPPORTED_CHAINS = getWalletSupportedChains(walletconnectWallet);
export type Walletconnect = ReturnType<typeof toWalletconnect>;

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

// One client and one modal per page: every `SignClient.init` opens its own relay socket and storage,
// and WalletConnect warns when it is initialised again.
let clientPromise: Promise<SignClientInstance> | undefined;
let modalPromise: Promise<{ modal: WalletConnectModal; core: typeof import("@walletconnect/modal-core") }> | undefined;

function getSignClient(
  projectId: string,
  { restoreOnly: _, targetWallet: _target, ...options }: WalletconnectOptions = {},
) {
  clientPromise ??= import("@walletconnect/sign-client")
    .then(async ({ SignClient }) => {
      const client = await SignClient.init({
        logger: DEFAULT_LOGGER,
        relayUrl: DEFAULT_RELAY_URL,
        ...options,
        metadata: getMetadata(options.metadata),
        projectId,
      });

      // Ended from the wallet's side, or expired, a session would otherwise leave its chains looking connected.
      client.on("session_delete", ({ topic }) => onSessionEnded(topic));
      client.on("session_expire", ({ topic }) => onSessionEnded(topic));

      return client;
    })
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });

  return clientPromise;
}

// The modal loads its UI and wallet list when created, and opens only once both are in. The list is fetched
// once, and a failed fetch (an ad blocker, a network error) would keep the modal shut for the rest of the page's
// life; past this it opens without the list, the QR code being all a pairing needs.
const WALLET_LIST_TIMEOUT = 3000;

function getModal(projectId: string) {
  modalPromise ??= Promise.all([import("@walletconnect/modal"), import("@walletconnect/modal-core")])
    .then(([{ WalletConnectModal }, core]) => {
      const modal = new WalletConnectModal({ projectId });
      setTimeout(() => core.OptionsCtrl.setIsDataLoaded(true), WALLET_LIST_TIMEOUT);
      return { core, modal };
    })
    .catch((error) => {
      modalPromise = undefined;
      throw error;
    });

  return modalPromise;
}

// A modal whose UI fails to load would otherwise leave the connect waiting, with nothing on screen, until the
// proposal expires.
const MODAL_OPEN_TIMEOUT = 15_000;

let pairings = 0;

/** Shows the QR code until the wallet approves, rejects, or the user closes the modal. */
async function pair(client: SignClientInstance, projectId: string, chains: Chain[], target?: WalletconnectTarget) {
  const proposal = client.connect({ optionalNamespaces: getNamespaces(chains.flatMap(chainToChainIds)) });
  // Handled below, once the modal is loaded; this only keeps a failed modal load from leaving it unhandled.
  proposal.catch(() => undefined);
  const { core, modal } = await getModal(projectId);
  const presentation = target && targetWalletPresentation(core, target, navigator);
  const pairing = ++pairings;

  return new Promise<SessionTypes.Struct>((resolve, reject) => {
    let settled = false;

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      modal.closeModal();
      presentation?.dispose();
      // Still loading, the modal would open after the connect is over; closed then, unless a later pairing has it.
      for (const opening of openings) {
        opening.then(() => pairing === pairings && modal.closeModal()).catch(() => undefined);
      }
      outcome();
    };

    // Without this the caller waits until the proposal expires, minutes after the modal is gone.
    const unsubscribe = modal.subscribeModal(({ open }) => {
      if (!open) {
        settle(() => reject(new USwapError("wallet_walletconnect_modal_closed")));
      }
    });

    // Opened before the proposal has its uri (a relay round trip), the modal shows a spinner in place of the QR code.
    const opening = modal.openModal();
    presentation?.route(false);
    const openings = [opening];
    const timeout = setTimeout(() => {
      // A UI that failed to load is not loaded again: the bundler keeps the failed chunk until a reload.
      const info = { reason: "The WalletConnect modal did not load. Reload the page and try again." };
      settle(() => reject(new USwapError({ errorKey: "wallet_walletconnect_connection_not_established", info })));
    }, MODAL_OPEN_TIMEOUT);
    opening.then(
      () => clearTimeout(timeout),
      (error) => settle(() => reject(error)),
    );

    proposal.then(
      ({ uri, approval }) => {
        if (!uri) {
          settle(() => reject(new USwapError("wallet_walletconnect_connection_not_established")));
          return;
        }

        approval().then(
          (session) => {
            // Approved after the modal closed: the user cancelled, so the session is not kept for a later
            // connect to pick up without a QR code.
            if (settled) {
              void endSession(client, session.topic);
              return;
            }
            settle(() => resolve(session));
          },
          (error) => settle(() => reject(new USwapError("wallet_walletconnect_connection_not_established", error))),
        );

        if (!settled) {
          openings.push(showUri(modal, uri));
          presentation?.route(true);
        }
      },
      (error) => settle(() => reject(new USwapError("wallet_walletconnect_connection_not_established", error))),
    );
  });
}

/**
 * Hands the open modal the uri. Opening again sets it for the modal's links and copy button, but the QR element
 * reads it only when created, so one already showing its spinner is given it directly (modal 2.7, the last
 * release of `@walletconnect/modal`).
 */
function showUri(modal: WalletConnectModal, uri: string) {
  const opening = modal.openModal({ uri });
  opening.catch(() => undefined);

  const root = document.querySelector("wcm-modal")?.shadowRoot;
  for (const qr of root ? queryShadowAll(root, "wcm-walletconnect-qr") : []) {
    (qr as Element & { uri?: string }).uri = uri;
  }

  return opening;
}

function queryShadowAll(root: ParentNode, selector: string): Element[] {
  return [
    ...root.querySelectorAll(selector),
    ...[...root.querySelectorAll("*")].flatMap((el) => (el.shadowRoot ? queryShadowAll(el.shadowRoot, selector) : [])),
  ];
}

type ApprovedChain<T extends Chain = Chain> = { chain: T; walletconnect: Walletconnect };

/**
 * The chains the wallet approved, each with the session it signs with, and on a restore the older sessions
 * that approved them too.
 */
async function getWalletconnects<T extends Chain>(
  chains: T[],
  projectId: string,
  walletconnectOptions?: WalletconnectOptions,
): Promise<{ approved: ApprovedChain<T>[]; client: SignClientInstance; superseded: string[] }> {
  const client = await getSignClient(projectId, walletconnectOptions).catch((error) => {
    throw new USwapError("wallet_walletconnect_connection_not_established", error);
  });

  const sessions = client.session.getAll().filter((session) => !isEnding(session.topic));

  if (walletconnectOptions?.restoreOnly) {
    // Each chain from the newest session that approved it: chains connected at different times sit in
    // different sessions, and one proposed a chain need not have approved it.
    const restored = findRestorableSessions(sessions, chains);
    if (restored.length === 0) throw new USwapError("wallet_walletconnect_connection_not_established");

    const byTopic = new Map<string, Walletconnect>();
    const approved = restored.map(({ chain, session }) => {
      const walletconnect = byTopic.get(session.topic) ?? toWalletconnect(client, session);
      byTopic.set(session.topic, walletconnect);
      return { chain, walletconnect };
    });

    const superseded = sessions
      .filter(
        (session) =>
          !byTopic.has(session.topic) && chains.some((chain) => getAddressByChain(chain, getSessionAccounts(session))),
      )
      .map((session) => session.topic);

    return { approved, client, superseded };
  }

  const target = walletconnectOptions?.targetWallet;
  const reusable = target ? undefined : findReusableSession(sessions, chains);
  const session = reusable ?? (await pair(client, projectId, chains, target));
  const walletconnect = toWalletconnect(client, session);

  // The proposal asks for every chain as optional, so the wallet may approve only some of them.
  const approved = chains.filter((chain) => getAddressByChain(chain, walletconnect.accounts));
  if (approved.length === 0) {
    await endSession(client, session.topic);
    throw new USwapError("wallet_walletconnect_chain_not_supported", { chains });
  }

  return { approved: approved.map((chain) => ({ chain, walletconnect })), client, superseded: [] };
}

function toWalletconnect(client: SignClientInstance, session: SessionTypes.Struct) {
  return { accounts: getSessionAccounts(session), client, session };
}
