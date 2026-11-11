import { afterEach, describe, expect, test } from "bun:test";
import * as core from "@walletconnect/modal-core";
import { oathWalletconnectTarget, targetWalletPresentation } from "../targetWallet";

const uri = "wc:fixture@2?relay-protocol=irn&symKey=fixture";
const desktop = { maxTouchPoints: 0, platform: "MacIntel", userAgent: "Macintosh" };
const target = { ...oathWalletconnectTarget, iconUrl: "/wallets/oath.svg" };

describe("direct WalletConnect pairing", () => {
  afterEach(() => {
    core.ModalCtrl.close();
    core.RouterCtrl.reset("ConnectWallet");
    core.RouterCtrl.setData(undefined);
  });

  for (const [device, expected] of [
    [desktop, "MobileQrcodeConnecting"],
    [{ ...desktop, userAgent: "Android" }, "MobileQrcodeConnecting"],
    [{ ...desktop, platform: "iPhone", userAgent: "iPhone" }, "MobileConnecting"],
    [{ ...desktop, maxTouchPoints: 5 }, "MobileConnecting"],
  ] as const) {
    test(`${device.userAgent} / ${device.maxTouchPoints} touches routes to ${expected} and restores the generic picker`, async () => {
      core.OptionsCtrl.setIsUiLoaded(true);
      core.OptionsCtrl.setIsDataLoaded(true);
      core.ConfigCtrl.setConfig({ projectId: "test", walletImages: { other: "/other.svg" } });
      const presentation = targetWalletPresentation(core, target, device);
      try {
        await core.ModalCtrl.open();
        presentation.route(false);
        expect(core.RouterCtrl.state.view).toBe("MobileQrcodeConnecting");
        expect(core.OptionsCtrl.state.walletConnectUri).toBeUndefined();

        await core.ModalCtrl.open({ uri });
        presentation.route(true);
        expect(core.RouterCtrl.state.view).toBe(expected);
        expect(core.RouterCtrl.state.data?.Wallet?.id).toBe(target.id);
        expect(core.ConfigCtrl.state.walletImages?.[target.id]).toBe(target.iconUrl);
        expect(core.OptionsCtrl.state.walletConnectUri).toBe(uri);
        expect(core.CoreUtil.formatNativeUrl(target.mobile.native, uri, target.name)).toBe(
          `oathwallet://wc?uri=${encodeURIComponent(uri)}`,
        );
      } finally {
        core.ModalCtrl.close();
        presentation.dispose();
      }
      await core.ModalCtrl.open();
      expect(core.RouterCtrl.state.view).toBe("ConnectWallet");
      expect(core.RouterCtrl.state.data).toBeUndefined();
      expect(core.ConfigCtrl.state.walletImages).toEqual({ other: "/other.svg" });
    });
  }
});
