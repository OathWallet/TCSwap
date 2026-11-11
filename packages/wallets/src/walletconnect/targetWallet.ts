import type * as ModalCore from "@walletconnect/modal-core";
import type { WalletconnectTarget } from "./types";

/** Native iOS wallet. The selector supplies its own local icon URL. */
export const oathWalletconnectTarget: WalletconnectTarget = {
  app: { ios: "https://apps.apple.com/app/id6780187283" },
  homepage: "https://oathwallet.org",
  id: "oath-ios",
  mobile: { native: "oathwallet://" },
  name: "Oath Wallet",
};

type Controllers = Pick<typeof ModalCore, "ConfigCtrl" | "RouterCtrl">;

export function targetWalletPresentation(
  { ConfigCtrl, RouterCtrl }: Controllers,
  { iconUrl, ...wallet }: WalletconnectTarget,
  device: { platform: string; maxTouchPoints: number; userAgent: string },
) {
  const images = ConfigCtrl.state.walletImages;
  if (iconUrl) ConfigCtrl.setConfig({ ...ConfigCtrl.state, walletImages: { ...images, [wallet.id]: iconUrl } });

  const ios =
    /iPhone|iPad|iPod/.test(device.userAgent) || (device.platform === "MacIntel" && device.maxTouchPoints > 1);
  return {
    dispose() {
      RouterCtrl.reset("ConnectWallet");
      RouterCtrl.setData(undefined);
      if (iconUrl) ConfigCtrl.setConfig({ ...ConfigCtrl.state, walletImages: images });
    },
    // Modal 2.7 synchronously resets its route on each open. Select the requested view before it renders.
    route(hasUri: boolean) {
      RouterCtrl.setData({ Wallet: wallet });
      RouterCtrl.reset(ios && hasUri ? "MobileConnecting" : "MobileQrcodeConnecting");
    },
  };
}
