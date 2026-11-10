/**
 * Modifications © 2025 Horizontal Systems.
 */

import "../styles/index.css";

import { Chain, WalletOption } from "@tcswap/core";
import { USwapProvider, useUSwap } from "@tcswap/ui/react";
import { useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function Content() {
  const { connect, getClient } = useUSwap<["chainflip", "evm"]>();

  const connectUSwap = useCallback(async () => {
    const skClient = await connect({ chains: [Chain.Cosmos, Chain.Ethereum], walletOption: WalletOption.CTRL });

    console.info(skClient.getAllWallets());
  }, [connect]);

  useEffect(() => {
    connectUSwap();
  }, [connectUSwap]);

  const runTx = useCallback(() => {
    const client = getClient();

    console.info(client.getAllWallets());
  }, [getClient]);

  const wallets = Object.values(getClient()?.getAllWallets() || {});

  return (
    <div className="container relative z-10 mx-auto p-8 text-center">
      <a href="/widget">Widget</a>

      <Card className="border-muted bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-6">
          {wallets?.[0]?.walletType}

          {wallets?.map((wallet) => (
            <div key={wallet.address}>
              {wallet.chain} - {wallet.address}
            </div>
          ))}

          <Button onClick={runTx}>Run Tx</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function App() {
  return (
    <USwapProvider config={{ apiKeys: { uSwap: "1234567890" } }} plugins={["chainflip", "evm"]}>
      <Content />
    </USwapProvider>
  );
}
