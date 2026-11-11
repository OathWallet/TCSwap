import type { CoreTypes, SignClientTypes } from "@walletconnect/types";

export interface ClientMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

/** A mobile wallet that can open a WalletConnect pairing on iOS, or scan it on another device. */
export interface WalletconnectTarget {
  id: string;
  name: string;
  homepage?: string;
  app: { ios: string };
  mobile: { native: string; universal?: string };
  iconUrl?: string;
}

export type WalletconnectOptions = Omit<SignClientTypes.Options, "metadata"> & {
  /** What the wallet shows on its approval screen. `url` defaults to the page's origin. */
  metadata?: Partial<CoreTypes.Metadata>;
  /** Start a fresh pairing in this wallet's QR / iOS view. Ignored for silent restoration. */
  targetWallet?: WalletconnectTarget;
  /** Reuse a stored session covering the chains, and fail rather than show a QR code when there is none. */
  restoreOnly?: boolean;
};
