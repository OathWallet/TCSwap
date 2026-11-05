import { crypto, type Psbt } from "bitcoinjs-lib";

/**
 * The toolbox builds inputs with only a witnessUtxo. A nested SegWit (3…) input also needs its redeemScript,
 * which only the account's public key can supply, or bitcoinjs-lib cannot finalize it ("Can not finalize input #0").
 *
 * The scripts are assembled from hash160 rather than `payments`, and compared as hex: the PSBT comes from the
 * toolbox's bitcoinjs-lib, and the copy resolved here may be another major (v7 works in plain Uint8Arrays, which
 * the browser Buffer#equals rejects with "Argument must be a Buffer").
 */
export function addNestedSegwitRedeemScripts(psbt: InstanceType<typeof Psbt>, publicKeyHex?: string) {
  // Without a key there is nothing to derive; native SegWit and Taproot inputs never needed one.
  if (typeof publicKeyHex !== "string") return;

  const pubkey = Buffer.from(publicKeyHex, "hex");
  // Taproot accounts report a 32-byte x-only key; only a compressed key can be a nested SegWit one.
  if (pubkey.length !== 33) return;

  // OP_0 <20-byte key hash>, wrapped as OP_HASH160 <20-byte script hash> OP_EQUAL
  const redeemScript = Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.from(crypto.hash160(pubkey))]);
  const outputHex = Buffer.concat([
    Buffer.from([0xa9, 0x14]),
    Buffer.from(crypto.hash160(redeemScript)),
    Buffer.from([0x87]),
  ]).toString("hex");

  psbt.data.inputs.forEach((input, index) => {
    const script = input.witnessUtxo?.script;
    if (!input.redeemScript && script && Buffer.from(script).toString("hex") === outputHex) {
      psbt.updateInput(index, { redeemScript });
    }
  });
}
