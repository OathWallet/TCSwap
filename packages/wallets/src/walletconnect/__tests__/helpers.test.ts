import { describe, expect, test } from "bun:test";
import { Chain } from "@tcswap/helpers";

import { chainToChainIds, findReusableSession, getAddressByChain, getSessionChainId } from "../helpers";
import { getNamespaces } from "../namespaces";

const EVM = "0x1111111111111111111111111111111111111111";
const OP = "0x2222222222222222222222222222222222222222";

describe("getAddressByChain", () => {
  test("matches the whole CAIP-2 id, not a prefix of it", () => {
    const accounts = [`eip155:10:${OP}`, `eip155:137:${OP}`, `eip155:1:${EVM}`];

    expect(getAddressByChain(Chain.Ethereum, accounts)).toBe(EVM);
    expect(getAddressByChain(Chain.Optimism, accounts)).toBe(OP);
  });

  test("is empty for a chain the wallet did not approve", () => {
    expect(getAddressByChain(Chain.THORChain, [`eip155:1:${EVM}`])).toBe("");
  });

  test("finds THORChain under its chain id or the legacy one", () => {
    expect(getAddressByChain(Chain.THORChain, ["cosmos:thorchain-1:thor1abc"])).toBe("thor1abc");
    expect(getAddressByChain(Chain.THORChain, ["cosmos:thorchain:thor1abc"])).toBe("thor1abc");
  });
});

describe("getSessionChainId", () => {
  test("is the id the wallet approved the chain under", () => {
    expect(getSessionChainId(Chain.THORChain, ["cosmos:thorchain:thor1abc"])).toBe("cosmos:thorchain");
    expect(getSessionChainId(Chain.THORChain, ["cosmos:thorchain-1:thor1abc"])).toBe("cosmos:thorchain-1");
  });

  test("falls back to the preferred id", () => {
    expect(getSessionChainId(Chain.THORChain, [])).toBe("cosmos:thorchain-1");
  });
});

describe("getNamespaces", () => {
  test("groups chain ids by namespace without crossing namespaces", () => {
    const namespaces = getNamespaces(
      [Chain.Ethereum, Chain.XLayer, Chain.THORChain, Chain.Maya, Chain.Tron].flatMap(chainToChainIds),
    );

    expect(namespaces.eip155?.chains).toEqual(["eip155:1", "eip155:196"]);
    expect(namespaces.cosmos?.chains).toEqual([
      "cosmos:thorchain-1",
      "cosmos:thorchain",
      "cosmos:mayachain-mainnet-v1",
    ]);
    expect(namespaces.tron?.chains).toEqual(["tron:0x2b6653dc"]);
    expect(namespaces.cosmos?.methods).toContain("cosmos_signAmino");
  });
});

describe("findReusableSession", () => {
  const session = (topic: string, proposed: string[], accounts: string[], expiry = Date.now() / 1000 + 3600) =>
    ({
      expiry,
      namespaces: { eip155: { accounts } },
      optionalNamespaces: { all: { chains: proposed } },
      requiredNamespaces: {},
      topic,
    }) as any;

  const proposed = ["eip155:1", "eip155:42161", "cosmos:thorchain-1", "cosmos:thorchain"];
  const partial = session("partial", proposed, [`eip155:1:${EVM}`, `eip155:42161:${EVM}`]);

  test("reuses a session the wallet approved only partly", () => {
    expect(findReusableSession([partial], [Chain.Ethereum, Chain.Arbitrum, Chain.THORChain])?.topic).toBe("partial");
    expect(findReusableSession([partial], [Chain.Ethereum, Chain.Arbitrum])?.topic).toBe("partial");
  });

  test("pairs anew for a chain the session was never proposed", () => {
    expect(findReusableSession([partial], [Chain.Ethereum, Chain.Tron])).toBeUndefined();
  });

  test("needs at least one approved chain", () => {
    expect(findReusableSession([partial], [Chain.THORChain])).toBeUndefined();
    expect(findReusableSession([partial], [])).toBeUndefined();
  });

  test("skips expired sessions and prefers the newest", () => {
    const expired = session("expired", proposed, [`eip155:1:${EVM}`], Date.now() / 1000 - 1);
    const newer = session("newer", proposed, [`eip155:1:${EVM}`], Date.now() / 1000 + 7200);

    expect(findReusableSession([expired], [Chain.Ethereum])).toBeUndefined();
    expect(findReusableSession([partial, newer], [Chain.Ethereum])?.topic).toBe("newer");
  });
});
