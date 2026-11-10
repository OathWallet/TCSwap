"use client";

import { showModal, useUSwap, WalletConnectDialog } from "@tcswap/ui/react";
import { Button } from "~/components/ui/button";
import { WalletDrawer } from "./WalletDrawer";

export function WalletButton({ className }: { className?: string }) {
  const { isWalletConnected } = useUSwap();

  if (isWalletConnected) {
    return (
      <Button className={className} onClick={() => showModal(<WalletDrawer />)} variant="primary">
        My Wallet
      </Button>
    );
  }

  const handleConnectWallet = async () => {
    const { confirmed } = await showModal(<WalletConnectDialog />);

    if (!confirmed) return;

    void showModal(<WalletDrawer />);
  };

  return (
    <Button
      className={className}
      onClick={handleConnectWallet}
      variant="primary">
      Connect Wallet
    </Button>
  );
}
