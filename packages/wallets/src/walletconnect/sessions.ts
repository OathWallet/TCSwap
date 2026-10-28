import type { Chain } from "@tcswap/helpers";
import type { SignClient } from "@walletconnect/sign-client";

export type SignClientInstance = Awaited<ReturnType<typeof SignClient.init>>;
type SessionClient = Pick<SignClientInstance, "disconnect" | "session">;

const USER_DISCONNECTED = { code: 6000, message: "User disconnected" };

// The session each connected chain signs with. One no chain signs with any more is ended: left alone,
// a later connect would pick it up without a QR code, even after the user disconnected.
const chainTopics = new Map<Chain, string>();
// Sessions chains are being set up with, in use as much as bound ones.
const settingUp = new Map<string, number>();
// Sessions being ended, which no connect picks up meanwhile.
const endingTopics = new Set<string>();
const disconnectListeners = new Set<(chains: Chain[]) => void>();

export function getBoundTopic(chain: Chain) {
  return chainTopics.get(chain);
}

/** Binds a chain to the session it signs with; returns the session it signed with until now. */
export function bindChain(chain: Chain, topic: string) {
  const previous = chainTopics.get(chain);
  chainTopics.set(chain, topic);
  return previous;
}

export function isEnding(topic: string) {
  return endingTopics.has(topic);
}

/** Counts the sessions in use while chains are set up with them; returns the function that stops counting. */
export function trackSetup(topics: string[]) {
  for (const topic of topics) settingUp.set(topic, (settingUp.get(topic) ?? 0) + 1);

  return () => {
    for (const topic of topics) {
      const count = (settingUp.get(topic) ?? 1) - 1;
      if (count > 0) settingUp.set(topic, count);
      else settingUp.delete(topic);
    }
  };
}

export function endUnusedSessions(client: SessionClient, topics: (string | undefined)[]) {
  const inUse = new Set(chainTopics.values());
  for (const topic of new Set(topics)) {
    if (topic && !inUse.has(topic) && !settingUp.has(topic)) void endSession(client, topic);
  }
}

/** Disconnects one chain; its session ends with the last chain that signs with it. */
export function disconnectChain(client: SessionClient, chain: Chain, topic: string) {
  if (chainTopics.get(chain) === topic) chainTopics.delete(chain);
  endUnusedSessions(client, [topic]);
}

export async function endSession(client: SessionClient, topic: string) {
  if (endingTopics.has(topic) || !client.session.keys.includes(topic)) return;
  endingTopics.add(topic);

  try {
    await client.disconnect({ reason: USER_DISCONNECTED, topic });
  } catch {
    // Offline, or the request failed: the session is still stored, where a later connect would reuse it without
    // a QR code. Dropped here, it stays with the wallet until it expires.
    await client.session.delete(topic, USER_DISCONNECTED).catch(() => undefined);
  } finally {
    endingTopics.delete(topic);
  }
}

/**
 * Calls `listener` with the chains whose session the wallet ended from its side, or that expired; they are no
 * longer connected. Returns the function that removes the listener.
 */
export function onWalletconnectDisconnect(listener: (chains: Chain[]) => void) {
  disconnectListeners.add(listener);
  return () => {
    disconnectListeners.delete(listener);
  };
}

export function onSessionEnded(topic: string) {
  const chains = [...chainTopics].filter(([, chainTopic]) => chainTopic === topic).map(([chain]) => chain);
  if (chains.length === 0) return;

  for (const chain of chains) chainTopics.delete(chain);
  for (const listener of disconnectListeners) {
    // One listener failing does not keep the news from the others.
    try {
      listener(chains);
    } catch (error) {
      console.error(error);
    }
  }
}
