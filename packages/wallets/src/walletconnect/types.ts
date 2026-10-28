import type { CoreTypes, SignClientTypes } from "@walletconnect/types";

export interface ClientMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export type WalletconnectOptions = Omit<SignClientTypes.Options, "metadata"> & {
  /** What the wallet shows on its approval screen. `url` defaults to the page's origin. */
  metadata?: Partial<CoreTypes.Metadata>;
  /** Reuse a stored session covering the chains, and fail rather than show a QR code when there is none. */
  restoreOnly?: boolean;
};
