/**
 * Modifications © 2025 Horizontal Systems.
 */

import { type EVMChain, USwapError, WalletOption } from "@tcswap/helpers";
import type { JsonRpcProvider, Provider, TransactionRequest } from "ethers";
import { AbstractSigner, hexlify, TransactionResponse, type TransactionResponseParams, toUtf8Bytes } from "ethers";

import { DEFAULT_EIP155_METHODS } from "./constants";
import { getAddressByChain, getSessionChainId } from "./helpers";
import type { Walletconnect } from "./index";

interface WalletconnectEVMSignerParams {
  chain: EVMChain;
  walletconnect: Walletconnect;
  provider: Provider | JsonRpcProvider;
}

class WalletconnectSigner extends AbstractSigner {
  address: string;

  private chain: EVMChain;
  private walletconnect: Walletconnect;
  readonly provider: Provider | JsonRpcProvider;

  constructor({ chain, provider, walletconnect }: WalletconnectEVMSignerParams) {
    super(provider);
    this.chain = chain;
    this.walletconnect = walletconnect;
    this.provider = provider;
    this.address = "";
  }

  // biome-ignore lint/suspicious/useAwait: fulfil implementation type
  getAddress = async () => {
    if (!this.address) {
      this.address = getAddressByChain(this.chain, this.walletconnect.accounts);
    }

    return this.address;
  };

  // `personal_sign` takes [message, address]; the bare `eth_sign` with no address is rejected by wallets.
  signMessage = async (message: string | Uint8Array) => {
    const signature = (await this.walletconnect.client.request({
      chainId: getSessionChainId(this.chain, this.walletconnect.accounts),
      request: {
        method: DEFAULT_EIP155_METHODS.PERSONAL_SIGN,
        params: [
          typeof message === "string" ? hexlify(toUtf8Bytes(message)) : hexlify(message),
          await this.getAddress(),
        ],
      },
      topic: this.walletconnect.session.topic,
    })) as string;

    return signature.startsWith("0x") ? signature : `0x${signature}`;
  };

  signTransaction = () => {
    throw new USwapError("wallet_walletconnect_method_not_supported", { method: "signTransaction" });

    // const baseTx = {
    //   from,
    //   to,
    //   value: BigNumber.from(value || 0).toHexString(),
    //   data,
    // };

    // const txHash = (await this.walletconnect?.client.request({
    //   chainId: chainToChainId(this.chain),
    //   topic: this.walletconnect.session.topic,
    //   request: {
    //     method: DEFAULT_EIP155_METHODS.ETH_SIGN_TRANSACTION,
    //     params: [baseTx],
    //   },
    // })) as string;

    // return txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  };

  // ANCHOR (@Towan) - Implement in future
  signTypedData = () => {
    throw new USwapError("wallet_walletconnect_method_not_supported", { method: "signTypedData" });

    // const { toHexString } = await import('@tcswap/toolboxes/evm');

    // const baseTx = {
    //   from,
    //   to,
    //   value: toHexString(value || 0n),
    //   data,
    // };

    // const txHash = (await this.walletconnect?.client.request({
    //   chainId: chainToChainId(this.chain),
    //   topic: this.walletconnect.session.topic,
    //   request: {
    //     method: DEFAULT_EIP155_METHODS.ETH_SIGN_TYPED_DATA,
    //     params: [baseTx],
    //   },
    // })) as string;

    // return txHash.startsWith('0x') ? txHash : `0x${txHash}`;
  };

  sendTransaction = async ({ from, to, value, data, gasLimit }: TransactionRequest) => {
    const { toHexString } = await import("@tcswap/toolboxes/evm");

    const sender = (from as string | undefined) || (await this.getAddress());
    const baseTx = {
      data,
      from: sender,
      to,
      value: toHexString(BigInt(value || 0)),
      // The toolbox has already estimated it; wallets fill fees and nonce themselves.
      ...(gasLimit ? { gas: toHexString(BigInt(gasLimit)) } : {}),
    };

    // The wallet broadcasts and answers with the hash alone, while callers read `.hash` and `.wait()`.
    // Nothing after the request may fail: the transaction is out, and an error would read as unsent.
    const sessionChainId = getSessionChainId(this.chain, this.walletconnect.accounts);
    const hash = (await this.walletconnect.client.request({
      chainId: sessionChainId,
      request: { method: DEFAULT_EIP155_METHODS.ETH_SEND_TRANSACTION, params: [baseTx] },
      topic: this.walletconnect.session.topic,
    })) as string;

    return new TransactionResponse(
      {
        blockHash: null,
        blockNumber: null,
        chainId: BigInt(sessionChainId.split(":")[1] || 0),
        data: (data as string) || "0x",
        from: sender,
        gasLimit: BigInt(gasLimit || 0),
        gasPrice: 0n,
        hash,
        index: 0,
        nonce: 0,
        to: (to as string) || null,
        type: 2,
        value: BigInt(value || 0),
      } as unknown as TransactionResponseParams,
      this.provider,
    );
  };

  connect = (provider: Provider | null) => {
    if (!provider) {
      throw new USwapError({
        errorKey: "wallet_provider_not_found",
        info: { chain: this.chain, wallet: WalletOption.WALLETCONNECT },
      });
    }

    return new WalletconnectSigner({ chain: this.chain, provider, walletconnect: this.walletconnect });
  };
}
export const getEVMSigner = async ({ chain, walletconnect, provider }: WalletconnectEVMSignerParams) =>
  new WalletconnectSigner({ chain, provider, walletconnect });
