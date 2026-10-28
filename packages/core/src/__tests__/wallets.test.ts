import { describe, expect, test } from "bun:test";
import { Chain, WalletOption } from "@tcswap/helpers";

import { USwap } from "../index";

const disconnected: string[] = [];

// A wallet whose connect adds the chains with `address`, and with a `disconnect` unless told not to.
const fakeWallet = (walletType: WalletOption, name: string) => ({
  [name]: {
    connectWallet: ({ addChain }: any) =>
      function connect(chains: Chain[], address: string, withDisconnect = true) {
        for (const chain of chains) {
          const disconnect = () => disconnected.push(`${walletType}:${chain}`);
          addChain({ address, chain, walletType, ...(withDisconnect ? { disconnect } : {}) });
        }
        return Promise.resolve(true);
      },
    supportedChains: [Chain.Ethereum, Chain.THORChain],
  },
});

const create = () =>
  USwap({
    wallets: {
      ...fakeWallet(WalletOption.WALLETCONNECT, "connectWc"),
      ...fakeWallet(WalletOption.METAMASK, "connectMm"),
    } as any,
  }) as any;

describe("addChain", () => {
  test("does not carry another wallet's fields over to the chain", async () => {
    const uSwap = create();
    await uSwap.connectWc([Chain.Ethereum], "0xwc");
    await uSwap.connectMm([Chain.Ethereum], "0xmm", false);

    expect(uSwap.getWalletByChain(Chain.Ethereum).disconnect).toBeUndefined();
    expect(uSwap.getWalletByChain(Chain.Ethereum).address).toBe("0xmm");
  });

  test("carries the balance over only from the same address", async () => {
    const uSwap = create();
    await uSwap.connectMm([Chain.Ethereum], "0xmm");
    const balance = ["stale"];
    uSwap.getWalletByChain(Chain.Ethereum).balance = balance;

    await uSwap.connectMm([Chain.Ethereum], "0xmm");
    expect(uSwap.getWalletByChain(Chain.Ethereum).balance).toBe(balance);

    await uSwap.connectMm([Chain.Ethereum], "0xother");
    expect(uSwap.getWalletByChain(Chain.Ethereum).balance).not.toBe(balance);
  });
});

describe("disconnectAll", () => {
  test("ends every wallet's chains, including those behind another wallet", async () => {
    disconnected.length = 0;
    const uSwap = create();
    await uSwap.connectWc([Chain.Ethereum, Chain.THORChain], "0xwc");
    await uSwap.connectMm([Chain.Ethereum], "0xmm");

    uSwap.disconnectAll();

    expect(disconnected.sort()).toEqual(["METAMASK:ETH", "WALLETCONNECT:ETH", "WALLETCONNECT:THOR"]);
    expect(uSwap.getWalletByChain(Chain.Ethereum)).toBeUndefined();
    expect(uSwap.getWallet(WalletOption.WALLETCONNECT, Chain.Ethereum)).toBeUndefined();
  });
});

describe("disconnectWallet", () => {
  test("ends the wallet's session on chains another wallet took over, leaving their slot", async () => {
    disconnected.length = 0;
    const uSwap = create();
    await uSwap.connectWc([Chain.Ethereum, Chain.THORChain], "0xwc");
    await uSwap.connectMm([Chain.Ethereum], "0xmm", false);

    uSwap.disconnectWallet(WalletOption.WALLETCONNECT);

    expect(disconnected.sort()).toEqual(["WALLETCONNECT:ETH", "WALLETCONNECT:THOR"]);
    expect(uSwap.getWalletByChain(Chain.Ethereum).address).toBe("0xmm");
    expect(uSwap.getWalletByChain(Chain.THORChain)).toBeUndefined();
    expect(uSwap.getWallet(WalletOption.WALLETCONNECT, Chain.Ethereum)).toBeUndefined();
  });

  test("disconnects only the chains given, handing them back", async () => {
    disconnected.length = 0;
    const uSwap = create();
    await uSwap.connectMm([Chain.Ethereum], "0xmm", false);
    await uSwap.connectWc([Chain.Ethereum, Chain.THORChain], "0xwc");

    uSwap.disconnectWallet(WalletOption.WALLETCONNECT, [Chain.Ethereum]);

    expect(disconnected).toEqual(["WALLETCONNECT:ETH"]);
    expect(uSwap.getWalletByChain(Chain.Ethereum).address).toBe("0xmm");
    expect(uSwap.getWallet(WalletOption.WALLETCONNECT, Chain.Ethereum)).toBeUndefined();
    expect(uSwap.getWallet(WalletOption.WALLETCONNECT, Chain.THORChain).address).toBe("0xwc");
  });

  test("hands the chain back to the most recently connected wallet still on it", async () => {
    const uSwap = USwap({
      wallets: {
        ...fakeWallet(WalletOption.WALLETCONNECT, "connectWc"),
        ...fakeWallet(WalletOption.METAMASK, "connectMm"),
        ...fakeWallet(WalletOption.RABBY, "connectRabby"),
      } as any,
    }) as any;
    await uSwap.connectMm([Chain.Ethereum], "0xmm", false);
    await uSwap.connectRabby([Chain.Ethereum], "0xrabby", false);
    await uSwap.connectWc([Chain.Ethereum], "0xwc");

    uSwap.disconnectWallet(WalletOption.WALLETCONNECT);

    expect(uSwap.getWalletByChain(Chain.Ethereum).address).toBe("0xrabby");
  });

  test("goes on when a chain's disconnect throws or rejects", async () => {
    const uSwap = create();
    await uSwap.connectWc([Chain.Ethereum, Chain.THORChain], "0xwc");
    uSwap.getWallet(WalletOption.WALLETCONNECT, Chain.Ethereum).disconnect = () => {
      throw new Error("no revoke");
    };
    uSwap.getWallet(WalletOption.WALLETCONNECT, Chain.THORChain).disconnect = () =>
      Promise.reject(new Error("no revoke"));

    expect(() => uSwap.disconnectWallet(WalletOption.WALLETCONNECT)).not.toThrow();
    expect(uSwap.getWalletByChain(Chain.Ethereum)).toBeUndefined();
    expect(uSwap.getWalletByChain(Chain.THORChain)).toBeUndefined();
  });

  test("hands the chain back to another wallet still connected on it", async () => {
    const uSwap = create();
    await uSwap.connectMm([Chain.Ethereum], "0xmm", false);
    await uSwap.connectWc([Chain.Ethereum], "0xwc");

    uSwap.disconnectWallet(WalletOption.WALLETCONNECT);

    expect(uSwap.getWalletByChain(Chain.Ethereum).address).toBe("0xmm");
  });
});
