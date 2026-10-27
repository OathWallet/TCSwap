import type { SignClientTypes } from "@walletconnect/types";

export interface ClientMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export type WalletconnectOptions = SignClientTypes.Options & {
  /** Reuse a stored session covering the chains, and fail rather than show a QR code when there is none. */
  restoreOnly?: boolean;
};
