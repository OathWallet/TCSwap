/**
 * Modifications © 2025 Horizontal Systems.
 */

import { Chain } from "@tcswap/helpers";
import { keystoreWallet, USwap } from "@tcswap/sdk";
import { KEYSTORE_SUPPORTED_CHAINS } from "@tcswap/wallets/keystore";

const uSwap = USwap({ wallets: keystoreWallet });

const phrase = process.env.TEST_PHRASE;

if (!phrase) {
  throw new Error("TEST_PHRASE is not set");
}

console.info("Connecting to keystore...");
await uSwap.connectKeystore(KEYSTORE_SUPPORTED_CHAINS, phrase);
console.info("Connected to keystore");

console.info("Getting balance...");
const balance = await uSwap.getBalance(Chain.Bitcoin);
console.info("Balance:", balance);

console.info("Addresses: ");

for (const chain of KEYSTORE_SUPPORTED_CHAINS) {
  const address = uSwap.getAddress(chain);
  console.info(`${chain}: ${address}`);
}
