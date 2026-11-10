/**
 * Modifications © 2025 Horizontal Systems.
 */

"use client";

import { AssetValue, Chain, getMAYANameCost } from "@tcswap/helpers";
import { useUSwap } from "@tcswap/ui/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export default function Send() {
  const { uSwap, checkIfChainConnected } = useUSwap();
  const name = "TEST_OF_TCSWAP";

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>Register MAYAName</CardTitle>
          <CardDescription>Do not approve the tx without changing the name in the code first ;)</CardDescription>
        </CardHeader>

        <CardContent className="mt-3">
          <Button
            onClick={() => {
              if (!uSwap) {
                alert("Please init TCSwap");
                return;
              }
              if (!checkIfChainConnected(Chain.Maya)) {
                alert("Please connect wallet first");
                return;
              }

              uSwap.mayachain.registerName({
                address: uSwap.getAddress(Chain.Maya),
                assetValue: AssetValue.from({ chain: Chain.Maya, value: getMAYANameCost(1) }),
                chain: Chain.Maya,
                name,
              });
            }}>
            Register MAYAName "{name}" for 1 year
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
