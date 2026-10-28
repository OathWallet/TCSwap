import { describe, expect, spyOn, test } from "bun:test";
import { Chain } from "@tcswap/helpers";

import {
  bindChain,
  disconnectChain,
  endSession,
  endUnusedSessions,
  getBoundTopic,
  onSessionEnded,
  onWalletconnectDisconnect,
  trackSetup,
} from "../sessions";

// A sign client holding `topics`, recording the sessions it ends.
const fakeClient = (topics: string[], { offline = false } = {}) => {
  const stored = new Set(topics);
  const ended: string[] = [];

  return {
    disconnect: async ({ topic }: { topic: string }) => {
      await Promise.resolve();
      if (offline) throw new Error("offline");
      ended.push(topic);
      stored.delete(topic);
    },
    ended,
    session: {
      delete: (topic: string) => {
        stored.delete(topic);
        return Promise.resolve();
      },
      get keys() {
        return [...stored];
      },
    },
    stored,
  } as any;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("disconnectChain", () => {
  test("ends a session with the last chain that signs with it", async () => {
    const client = fakeClient(["shared"]);
    bindChain(Chain.Ethereum, "shared");
    bindChain(Chain.THORChain, "shared");

    disconnectChain(client, Chain.Ethereum, "shared");
    await settle();
    expect(client.ended).toEqual([]);
    expect(getBoundTopic(Chain.THORChain)).toBe("shared");

    disconnectChain(client, Chain.THORChain, "shared");
    await settle();
    expect(client.ended).toEqual(["shared"]);
  });
});

describe("endUnusedSessions", () => {
  test("leaves a session chains are being set up with", async () => {
    const client = fakeClient(["setting-up"]);
    const setUp = trackSetup(["setting-up"]);

    endUnusedSessions(client, ["setting-up"]);
    await settle();
    expect(client.ended).toEqual([]);

    setUp();
    endUnusedSessions(client, ["setting-up"]);
    await settle();
    expect(client.ended).toEqual(["setting-up"]);
  });

  test("leaves a session a chain is bound to", async () => {
    const client = fakeClient(["bound"]);
    bindChain(Chain.Arbitrum, "bound");

    endUnusedSessions(client, ["bound", undefined]);
    await settle();
    expect(client.ended).toEqual([]);

    disconnectChain(client, Chain.Arbitrum, "bound");
  });
});

describe("endSession", () => {
  test("ends a session once when asked twice", async () => {
    const client = fakeClient(["twice"]);

    await Promise.all([endSession(client, "twice"), endSession(client, "twice")]);
    expect(client.ended).toEqual(["twice"]);
  });

  test("drops the session when the wallet cannot be told", async () => {
    const client = fakeClient(["offline"], { offline: true });

    await endSession(client, "offline");
    expect(client.stored.has("offline")).toBe(false);
  });
});

describe("onSessionEnded", () => {
  test("reports the session's chains to every listener, even past one that throws", () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const reported: Chain[][] = [];
    const removeThrowing = onWalletconnectDisconnect(() => {
      throw new Error("listener");
    });
    const remove = onWalletconnectDisconnect((chains) => reported.push(chains));
    bindChain(Chain.Base, "ended");
    bindChain(Chain.Optimism, "ended");

    onSessionEnded("ended");
    onSessionEnded("unknown");

    expect(reported).toEqual([[Chain.Base, Chain.Optimism]]);
    expect(getBoundTopic(Chain.Base)).toBeUndefined();

    removeThrowing();
    remove();
    error.mockRestore();
  });
});
