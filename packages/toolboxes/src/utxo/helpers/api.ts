/**
 * Modifications © 2025 Horizontal Systems.
 */

import secp256k1 from "@bitcoinerlab/secp256k1";
import { networks as zcashNetworks } from "@bitgo/utxo-lib";
import { Chain, getRPCUrl, RequestClient, USwapConfig, USwapError, type UTXOChain, warnOnce } from "@tcswap/helpers";
import { address as btcAddress, initEccLib, networks } from "bitcoinjs-lib";
// @ts-expect-error
import coininfo from "coininfo";
import { uniqid } from "../../utils";

type BlockchairParams<T> = T & { chain: Chain; apiKey?: string };
type BlockchairFetchUnspentUtxoParams = BlockchairParams<{
  offset?: number;
  limit?: number;
  address: string;
  targetValue?: number;
  accumulativeValue?: number;
  keyless?: boolean;
}>;

async function broadcastUTXOTx({ chain, txHash }: { chain: Chain; txHash: string }) {
  // Use Blockchair's push transaction endpoint (no API key needed)
  const url = `${baseUrl(chain)}/push/transaction`;
  const body = JSON.stringify({ data: txHash });

  try {
    const response = await RequestClient.post<{
      data: { transaction_hash: string } | null;
      context: { code: number; error?: string };
    }>(url, { body, headers: { "Content-Type": "application/json" } });

    if (response.context.code !== 200) {
      throw new USwapError("toolbox_utxo_broadcast_failed", {
        error: response.context.error || "Transaction broadcast failed",
      });
    }

    return response.data?.transaction_hash || txHash;
  } catch (error) {
    // Fallback to RPC if Blockchair fails
    const rpcUrl = await getRPCUrl(chain);
    if (rpcUrl) {
      const rpcBody = JSON.stringify({ id: uniqid(), jsonrpc: "2.0", method: "sendrawtransaction", params: [txHash] });

      const rpcResponse = await RequestClient.post<{
        id: string;
        result: string;
        error: { message: string; code?: number } | null;
      }>(rpcUrl, { body: rpcBody, headers: { "Content-Type": "application/json" } });

      if (rpcResponse.error) {
        throw new USwapError("toolbox_utxo_broadcast_failed", { error: rpcResponse.error?.message });
      }

      if (rpcResponse.result.includes('"code":-26')) {
        throw new USwapError("toolbox_utxo_invalid_transaction", { error: "Transaction amount was too low" });
      }

      return rpcResponse.result;
    }

    throw error;
  }
}

const BLOCKCHAIR_URL = "https://api.blockchair.com";

// `keyless` goes straight to Blockchair's free tier (1440 requests a day per IP), bypassing
// any configured proxy and its key.
function baseUrl(chain: Chain, keyless = false) {
  const customUrl = USwapConfig.get("envs").blockchairApiUrl;
  const host = keyless ? BLOCKCHAIR_URL : (customUrl ?? BLOCKCHAIR_URL);
  return `${host}/${mapChainToBlockchairChain(chain)}`;
}

function getDefaultTxFeeByChain(chain: Chain) {
  switch (chain) {
    case Chain.Bitcoin:
      return 5;
    case Chain.Dogecoin:
      return 10000;
    case Chain.Litecoin:
      return 1;
    case Chain.Zcash:
      return 1;
    default:
      return 2;
  }
}

function mapChainToBlockchairChain(chain: Chain) {
  switch (chain) {
    case Chain.BitcoinCash:
      return "bitcoin-cash";
    case Chain.Litecoin:
      return "litecoin";
    case Chain.Dash:
      return "dash";
    case Chain.Dogecoin:
      return "dogecoin";
    case Chain.Zcash:
      return "zcash";
    case Chain.Polkadot:
      return "polkadot";
    default:
      return "bitcoin";
  }
}

async function getSuggestedTxFee(chain: Chain) {
  try {
    //Use Bitgo API for fee estimation
    //Refer: https://app.bitgo.com/docs/#operation/v2.tx.getfeeestimate
    const { feePerKb } = await RequestClient.get<{
      feePerKb: number;
      cpfpFeePerKb: number;
      numBlocks: number;
      feeByBlockTarget: { 1: number; 3: number };
    }>(`https://app.bitgo.com/api/v2/${chain.toLowerCase()}/tx/fee`);
    const suggestedFee = feePerKb / 1000;

    return Math.max(suggestedFee, getDefaultTxFeeByChain(chain));
  } catch {
    return getDefaultTxFeeByChain(chain);
  }
}

// Balance and UTXO reads run on every balance refresh. Blockchair answers 402/429/43x once
// a key (or, without one, the caller's IP) is out of quota, and retrying only spends more of
// it, so each call is made once and a failure moves straight on to the next source (see
// utxoFallbacks).
const noRetry = { retry: { maxRetries: 0 }, timeoutMs: 10_000 };

async function blockchairRequest<T>(url: string, apiKey?: string): Promise<T> {
  const response = await RequestClient.get<BlockchairResponse<T>>(
    `${url}${apiKey ? `${url.includes("?") ? "&" : "?"}key=${apiKey}` : ""}`,
    noRetry,
  );

  if (!response || response.context.code !== 200)
    throw new USwapError("toolbox_utxo_api_error", { error: `Failed to query ${url}` });

  return response.data as T;
}

async function getAddressData({ address, chain, apiKey }: BlockchairParams<{ address?: string }>) {
  if (!address) throw new USwapError("toolbox_utxo_invalid_params", { error: "Address is required" });

  try {
    return await withFallback(
      chain,
      async () => {
        const response = await blockchairRequest<BlockchairAddressResponse>(
          `${baseUrl(chain)}/dashboards/address/${address}?transaction_details=true`,
          apiKey,
        );
        return response[address];
      },
      (api) => api.getAddressData(address),
    );
  } catch {
    return { address: { balance: 0, transaction_count: 0 }, utxo: [] };
  }
}

async function getUnconfirmedBalance({ address, chain, apiKey }: BlockchairParams<{ address?: string }>) {
  const response = await getAddressData({ address, apiKey, chain });

  return response?.address.balance || 0;
}

async function getRawTx({ chain, apiKey, txHash }: BlockchairParams<{ txHash?: string }>) {
  if (!txHash) throw new USwapError("toolbox_utxo_invalid_params", { error: "TxHash is required" });

  try {
    return await withFallback(
      chain,
      async () => {
        const rawTxResponse = await blockchairRequest<BlockchairRawTransactionResponse>(
          `${baseUrl(chain)}/raw/transaction/${txHash}`,
          apiKey,
        );
        return rawTxResponse?.[txHash]?.raw_transaction || "";
      },
      (api) => api.getRawTx(txHash),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to fetch raw transaction: ${errorMessage}`);
    return "";
  }
}

async function fetchUtxosBatch({
  chain,
  address,
  apiKey,
  keyless,
  offset = 0,
  limit = 30,
}: BlockchairFetchUnspentUtxoParams) {
  // Only fetch the fields we need to reduce payload size
  const fields = "is_spent,transaction_hash,index,value,script_hex,block_id,spending_signature_hex";

  const response = await blockchairRequest<BlockchairOutputsResponse[]>(
    // TODO - remove max value limit once we updated bitcoinjs-lib to support larger values
    `${baseUrl(chain, keyless)}/outputs?q=recipient(${address}),is_spent(false),value(..2000000000000000)&s=value(desc)&fields=${fields}&limit=${limit}&offset=${offset}`,
    keyless ? undefined : apiKey,
  );

  const txs = response.map(
    ({ is_spent, script_hex, block_id, transaction_hash, index, value, spending_signature_hex }) => ({
      hash: transaction_hash,
      index,
      is_confirmed: block_id !== -1,
      is_spent,
      script_hex,
      txHex: spending_signature_hex,
      value,
    }),
  );

  return txs;
}

function getTxsValue(txs: Awaited<ReturnType<typeof fetchUtxosBatch>>) {
  return txs.reduce((total, tx) => total + tx.value, 0);
}

function pickMostValuableTxs(
  txs: Awaited<ReturnType<typeof fetchUtxosBatch>>,
  targetValue?: number,
): Awaited<ReturnType<typeof fetchUtxosBatch>> {
  const sortedTxs = [...txs].sort((a, b) => b.value - a.value);

  if (targetValue) {
    const result = [];
    let accumulated = 0;

    for (const utxo of sortedTxs) {
      result.push(utxo);
      accumulated += utxo.value;
      if (accumulated >= targetValue) break;
    }

    return result;
  }

  return sortedTxs;
}

async function getUnspentUtxos({
  chain,
  address,
  apiKey,
  keyless,
  targetValue,
  accumulativeValue = 0,
  offset = 0,
  limit = 30,
}: BlockchairFetchUnspentUtxoParams): Promise<Awaited<ReturnType<typeof fetchUtxosBatch>>> {
  if (!address) throw new USwapError("toolbox_utxo_invalid_params", { error: "Address is required" });

  const utxos = await fetchUtxosBatch({ address, apiKey, chain, keyless, limit, offset, targetValue });
  const utxosCount = utxos.length;
  const isComplete = utxosCount < limit;

  const unspentUtxos = utxos.filter(({ is_spent }) => !is_spent);

  const unspentUtxosValue = getTxsValue(unspentUtxos);
  const totalCurrentValue = accumulativeValue + unspentUtxosValue;

  const limitReached = targetValue && totalCurrentValue >= targetValue;

  if (isComplete || limitReached) {
    return pickMostValuableTxs(unspentUtxos, targetValue);
  }

  const nextBatch = await getUnspentUtxos({
    accumulativeValue: totalCurrentValue,
    address,
    apiKey,
    chain,
    keyless,
    limit,
    offset: offset + limit,
    targetValue,
  });

  const allUtxos = [...unspentUtxos, ...nextBatch];

  return pickMostValuableTxs(allUtxos, targetValue);
}

async function getUtxos({
  address,
  chain,
  apiKey,
  fetchTxHex = true,
  targetValue,
}: BlockchairParams<{ address: string; fetchTxHex?: boolean; targetValue?: number }>) {
  // Errors used to be swallowed into an empty list, so an API outage (e.g. an
  // exhausted Blockchair key) surfaced as toolbox_utxo_insufficient_balance.
  let utxos: Awaited<ReturnType<typeof fetchUtxosBatch>>;
  try {
    utxos = await withFallback(
      chain,
      () => getUnspentUtxos({ address, apiKey, chain, targetValue }),
      async (api) => {
        const picked = pickMostValuableTxs(await api.getUtxos(address, chain, targetValue), targetValue);
        if (!fetchTxHex) return picked;
        // Take the raw txs from the same source rather than going back to Blockchair once
        // per input. (BlockCypher paces its own requests; see blockCypherGet.)
        return Promise.all(
          picked.map(async (utxo) => ({ ...utxo, txHex: utxo.txHex || (await api.getRawTx(utxo.hash)) })),
        );
      },
    );
  } catch (error) {
    throw new USwapError({ errorKey: "toolbox_utxo_api_error", info: { address, chain } }, error);
  }

  const results = [];

  // `txHex` is only ever set by a fallback above (Blockchair's is the spending
  // signature, always null for an unspent output).
  for (const { hash, index, script_hex, value, txHex: fetchedTxHex } of utxos) {
    let txHex: string | undefined;
    if (fetchTxHex) {
      txHex = fetchedTxHex || (await getRawTx({ apiKey, chain, txHash: hash }));
    }
    results.push({
      address,
      hash,
      index,
      txHex,
      value,
      witnessUtxo: { script: Buffer.from(script_hex, "hex"), value },
    });
  }
  return results;
}

// Keyless APIs that answer when Blockchair fails -- e.g. its key is out of quota.
// Tried in order after Blockchair; each sits behind the same interface so a chain
// can list as many as it needs.
type FallbackUtxo = Awaited<ReturnType<typeof fetchUtxosBatch>>[number];
type UtxoFallback = {
  name: string;
  // `targetValue` lets a source that needs a call per UTXO stop at the ones it will be picked for.
  getUtxos: (address: string, chain: Chain, targetValue?: number) => Promise<FallbackUtxo[]>;
  getAddressData: (address: string) => Promise<BlockchairAddressResponse[string]>;
  getRawTx: (txHash: string) => Promise<string>;
};

// A source that just failed (Blockchair out of quota, a stalled litecoinspace) is
// skipped for a while, so each balance refresh doesn't wait out its timeout again.
const SOURCE_COOLDOWN_MS = 2 * 60_000;
const sourceCoolingUntil = new Map<string, number>();

function isCoolingDown(source: string) {
  return (sourceCoolingUntil.get(source) ?? 0) > Date.now();
}

function coolDown(source: string, error: unknown) {
  // A 400/404 is about this request (e.g. Esplora refusing an address with
  // more than 500 UTXOs), not the source being down.
  const status = (error as { cause?: { status?: number } }).cause?.status;
  if (status === 400 || status === 404) return;
  sourceCoolingUntil.set(source, Date.now() + SOURCE_COOLDOWN_MS);
}

async function withFallback<T>(chain: Chain, primary: () => Promise<T>, fallback: (api: UtxoFallback) => Promise<T>) {
  const fallbacks = utxoFallbacks(chain);
  if (!fallbacks.length) return primary();

  const sources = [
    { name: `blockchair:${chain}`, run: primary },
    ...fallbacks.map((api) => ({ name: api.name, run: () => fallback(api) })),
  ];
  // In order, skipping any source that is cooling down -- unless all of them are.
  const ready = sources.filter(({ name }) => !isCoolingDown(name));

  const failures: unknown[] = [];
  for (const { name, run } of ready.length ? ready : sources) {
    try {
      return await run();
    } catch (error) {
      failures.push(error);
      coolDown(name, error);
    }
  }
  // Report every source, not just Blockchair: its failure is often the least telling one.
  throw new Error(failures.map((e) => (e instanceof Error ? e.message : String(e))).join(" | "));
}

// Neither fallback's UTXO list is guaranteed to carry the output script; the
// toolbox needs it for the PSBT's witnessUtxo. (Taproot addresses need the ECC lib to decode.)
function outputScriptHex(address: string, chain: Chain) {
  initEccLib(secp256k1);
  return Buffer.from(btcAddress.toOutputScript(address, getUtxoNetwork()(chain))).toString("hex");
}

function toFallbackUtxo(
  hash: string,
  index: number,
  value: number,
  confirmed: boolean,
  script_hex: string,
): FallbackUtxo {
  return { hash, index, is_confirmed: confirmed, is_spent: false, script_hex, txHex: null, value };
}

type EsploraUtxo = { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } };
type EsploraStats = { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };

async function esploraText(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

function esplora(host: string): UtxoFallback {
  const getUtxoList = (address: string) => RequestClient.get<EsploraUtxo[]>(`${host}/address/${address}/utxo`, noRetry);

  return {
    getAddressData: async (address) => {
      const [{ chain_stats, mempool_stats }, utxos] = await Promise.all([
        RequestClient.get<{ chain_stats: EsploraStats; mempool_stats: EsploraStats }>(
          `${host}/address/${address}`,
          noRetry,
        ),
        getUtxoList(address),
      ]);

      return {
        address: {
          balance:
            chain_stats.funded_txo_sum -
            chain_stats.spent_txo_sum +
            mempool_stats.funded_txo_sum -
            mempool_stats.spent_txo_sum,
          transaction_count: chain_stats.tx_count + mempool_stats.tx_count,
        },
        transactions: [] as BlockchairTransaction[],
        utxo: utxos.map(({ txid, vout, value, status }) => ({
          block_id: status.block_height ?? -1,
          index: vout,
          transaction_hash: txid,
          value,
        })),
      } as BlockchairAddressResponse[string];
    },
    getRawTx: (txHash) => esploraText(`${host}/tx/${txHash}/hex`),
    getUtxos: async (address, chain) => {
      const script_hex = outputScriptHex(address, chain);
      return (await getUtxoList(address)).map(({ txid, vout, value, status }) =>
        toFallbackUtxo(txid, vout, value, status.confirmed, script_hex),
      );
    },
    name: host,
  };
}

type BlockCypherTxRef = {
  tx_hash: string;
  tx_output_n: number;
  value: number;
  // Absent (null) while unconfirmed.
  block_height?: number | null;
  spent?: boolean;
  double_spend?: boolean;
};
type BlockCypherAddress = {
  final_balance: number;
  final_n_tx: number;
  txrefs?: BlockCypherTxRef[];
  unconfirmed_txrefs?: BlockCypherTxRef[];
  hasMore?: boolean;
};

// BlockCypher's free tier is ~100 requests/hour per IP. That is fine for a last
// resort called from each user's own browser, not as a primary source.
// BlockCypher's per-second limit (~3/s) is shared by every call this page makes,
// so space them all out -- not just one loop -- and ride out one 429 from a burst.
const BLOCKCYPHER_SPACING_MS = 350;
let blockCypherNextSlot = 0;

function blockCypherSlot() {
  const now = Date.now();
  const at = Math.max(now, blockCypherNextSlot);
  blockCypherNextSlot = at + BLOCKCYPHER_SPACING_MS;
  return new Promise((resolve) => setTimeout(resolve, at - now));
}

async function blockCypherGet<T>(url: string): Promise<T> {
  await blockCypherSlot();
  try {
    return await RequestClient.get<T>(url, noRetry);
  } catch (error) {
    // RequestClient puts the HTTP status on the error's cause.
    if ((error as { cause?: { status?: number } }).cause?.status !== 429) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await blockCypherSlot();
    return RequestClient.get<T>(url, noRetry);
  }
}

const BLOCKCYPHER_ADDRESS_TTL_MS = 15_000;
const blockCypherAddressCache = new Map<string, { data: Promise<BlockCypherAddress>; expires: number }>();

function blockCypher(coin: string): UtxoFallback {
  const base = `https://api.blockcypher.com/v1/${coin}/main`;

  async function getUnspent(address: string) {
    // A balance refresh reads the address data and then the UTXOs; share one call
    // (the free tier is ~100 requests/hour per IP).
    const url = `${base}/addrs/${address}?unspentOnly=true&limit=2000`;
    let entry = blockCypherAddressCache.get(url);
    if (!entry || entry.expires <= Date.now()) {
      const data = blockCypherGet<BlockCypherAddress>(url).catch((error) => {
        blockCypherAddressCache.delete(url);
        throw error;
      });
      entry = { data, expires: Date.now() + BLOCKCYPHER_ADDRESS_TTL_MS };
      blockCypherAddressCache.set(url, entry);
    }

    const data = await entry.data;
    // With `hasMore`, the list stops at 2000 (the most recent) unspent outputs. They are
    // still real, spendable UTXOs, so coin selection works on them; only
    // estimateMaxSendableAmount can come out low. `final_balance` stays exact.
    // Unconfirmed refs can also be the inputs of a pending spend (tx_output_n -1).
    const refs = [...(data.txrefs ?? []), ...(data.unconfirmed_txrefs ?? [])].filter(
      (ref) => ref.tx_output_n >= 0 && !ref.spent && !ref.double_spend,
    );
    return { data, refs };
  }

  return {
    getAddressData: async (address) => {
      const { data, refs } = await getUnspent(address);
      return {
        address: { balance: data.final_balance, transaction_count: data.final_n_tx },
        transactions: [] as BlockchairTransaction[],
        utxo: refs.map(({ tx_hash, tx_output_n, value, block_height }) => ({
          block_id: block_height && block_height > 0 ? block_height : -1,
          index: tx_output_n,
          transaction_hash: tx_hash,
          value,
        })),
      } as BlockchairAddressResponse[string];
    },
    getRawTx: async (txHash) => {
      const { hex } = await blockCypherGet<{ hex?: string }>(`${base}/txs/${txHash}?includeHex=true&limit=1`);
      if (!hex) throw new Error(`${base}/txs/${txHash}: no hex`);
      return hex;
    },
    getUtxos: async (address, chain) => {
      const script_hex = outputScriptHex(address, chain);
      const { refs } = await getUnspent(address);
      return refs.map(({ tx_hash, tx_output_n, value, block_height }) =>
        toFallbackUtxo(tx_hash, tx_output_n, value, !!block_height && block_height > 0, script_hex),
      );
    },
    name: base,
  };
}

// Blockchair's free tier, for when the configured key (or the proxy that adds it) is out of
// quota. It is limited per IP, so in a browser each user spends their own allowance.
function blockchairKeyless(chain: Chain): UtxoFallback {
  const base = baseUrl(chain, true);

  return {
    getAddressData: async (address) => {
      const response = await blockchairRequest<BlockchairAddressResponse>(
        `${base}/dashboards/address/${address}?transaction_details=true`,
      );
      const data = response[address];
      if (!data) throw new Error(`${base}/dashboards/address/${address}: no data`);
      return data;
    },
    getRawTx: async (txHash) => {
      const response = await blockchairRequest<BlockchairRawTransactionResponse>(`${base}/raw/transaction/${txHash}`);
      const rawTx = response?.[txHash]?.raw_transaction;
      if (!rawTx) throw new Error(`${base}/raw/transaction/${txHash}: no raw transaction`);
      return rawTx;
    },
    getUtxos: (address, _chain, targetValue) => getUnspentUtxos({ address, chain, keyless: true, targetValue }),
    name: `${base}:keyless`,
  };
}

const UTXO_FALLBACKS: Partial<Record<Chain, UtxoFallback[]>> = {
  [Chain.Bitcoin]: [esplora("https://mempool.space/api"), esplora("https://blockstream.info/api")],
  // litecoinspace.org is the only public Litecoin Esplora, and its address index can stall for minutes.
  [Chain.Litecoin]: [esplora("https://litecoinspace.org/api"), blockCypher("ltc")],
};

// After Blockchair as configured: its free tier (unless that is already what was tried), then
// the chain's own fallbacks.
function utxoFallbacks(chain: Chain): UtxoFallback[] {
  const configuredIsKeyless = !(USwapConfig.get("envs").blockchairApiUrl || USwapConfig.get("apiKeys").blockchair);
  return [...(configuredIsKeyless ? [] : [blockchairKeyless(chain)]), ...(UTXO_FALLBACKS[chain] ?? [])];
}

export function getUtxoApi(chain: UTXOChain) {
  const apiKey = USwapConfig.get("apiKeys").blockchair || "";

  warnOnce({
    condition: !apiKey,
    id: "no_blockchair_api_key_warning",
    warning: "No Blockchair API key found. Functionality will be limited.",
  });

  return {
    broadcastTx: async (txHash: string) => {
      const hash = await broadcastUTXOTx({ chain, txHash });
      // The sender's cached UTXOs are now spent; don't build the next tx from them.
      blockCypherAddressCache.clear();
      return hash;
    },
    getAddressData: (address: string) => getAddressData({ address, apiKey, chain }),
    getBalance: (address: string) => getUnconfirmedBalance({ address, apiKey, chain }),
    getRawTx: (txHash: string) => getRawTx({ apiKey, chain, txHash }),
    getSuggestedTxFee: () => getSuggestedTxFee(chain),
    getUtxos: (params: { address: string; fetchTxHex?: boolean; targetValue?: number }) =>
      getUtxos({ ...params, apiKey, chain }),
  };
}

/**
 * "Factory" to ensure typing for custom UTXO APIs
 */
export function createCustomUtxoApi(methods: ReturnType<typeof getUtxoApi>) {
  return methods;
}

export function getUtxoNetwork() {
  return function getNetwork(chain: Chain) {
    switch (chain) {
      case Chain.Bitcoin:
        return networks.bitcoin;
      case Chain.BitcoinCash:
        return coininfo.bitcoincash.main.toBitcoinJS();
      case Chain.Dash:
        return coininfo.dash.main.toBitcoinJS();
      case Chain.Litecoin:
        return coininfo.litecoin.main.toBitcoinJS();

      case Chain.Dogecoin: {
        const bip32 = { private: 0x04358394, public: 0x043587cf };
        const test = coininfo.dogecoin.test;
        test.versions.bip32 = bip32;
        return coininfo.dogecoin.main.toBitcoinJS();
      }

      case Chain.Zcash: {
        return zcashNetworks.zcash;
      }

      default:
        throw new USwapError("toolbox_utxo_not_supported", { chain });
    }
  };
}

interface BlockchairVin {
  txid: string;
  vout: number;
  scriptSig: { asm: string; hex: string };
  sequence: number;
}

interface BlockchairVout {
  value: number;
  n: number;
  scriptPubKey: { asm: string; hex: string; address: string; type: string; addresses: string[]; reqSigs: number };
}

interface BlockchairTransaction {
  block_id: number;
  hash: string;
  time: string;
  balance_change: number;
}

interface BlockchairUtxo {
  block_id: number;
  transaction_hash: string;
  index: number;
  value: number;
}

interface BlockchairAddressCoreData {
  type: string;
  script_hex: string;
  balance: number;
  balance_usd: number;
  received: number;
  received_usd: number;
  spent: number;
  spent_usd: number;
  output_count: number;
  unspent_output_count: number;
  first_seen_receiving: string;
  last_seen_receiving: string;
  first_seen_spending: null | string;
  last_seen_spending: null | string;
  transaction_count: number;
  scripthash_type: null | string;
}

interface BlockchairInputOutputCommonData {
  block_id: number;
  transaction_id: number;
  index: number;
  transaction_hash: string;
  date: string;
  time: string;
  value: number;
  value_usd: number;
  recipient: string;
  type: string;
  script_hex: string;
  is_from_coinbase: boolean;
  is_spendable: boolean | null;
  is_spent: boolean;
  lifespan: number | null;
  cdd: number | null;
}

interface BlockchairSpendingBlockData {
  spending_block_id: number | null;
  spending_transaction_id: number | null;
  spending_index: number | null;
  spending_transaction_hash: string | null;
  spending_date: string | null;
  spending_time: string | null;
  spending_value_usd: number | null;
  spending_sequence: number | null;
  spending_signature_hex: string | null;
  spending_witness: string | null;
}

interface BlockchairAddressResponse {
  [key: string]: { address: BlockchairAddressCoreData; transactions: BlockchairTransaction[]; utxo: BlockchairUtxo[] };
}

interface BlockchairOutputsResponse extends BlockchairSpendingBlockData, BlockchairInputOutputCommonData {}

interface BlockchairRawTransactionResponse {
  [key: string]: {
    raw_transaction: string;
    decoded_raw_transaction: {
      txid: string;
      hash: string;
      version: number;
      size: number;
      vsize: number;
      weight: number;
      locktime: number;
      vin: BlockchairVin[];
      vout: BlockchairVout[];
    };
  };
}

interface BlockchairResponse<T> {
  data: T;
  context: {
    code: number;
    source: string;
    results: number;
    state: number;
    market_price_usd: number;
    cache: { live: boolean; duration: number; since: string; until: string; time: any };
    api: {
      version: string;
      last_major_update: string;
      next_major_update: null | string;
      documentation: string;
      notice: string;
    };
    servers: string;
    time: number;
    render_time: number;
    full_time: number;
    request_cost: number;
  };
}
