/**
 * A stand-in for a browser wallet extension, for testing the wallet path.
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything else in this repo can be tested headlessly, but the wallet path
 * cannot: `useWallet()`, the connect picker, the `signMessage` prompt, the
 * declined-signature branch and the transaction send all only run inside a
 * browser with an extension present. Driving a real Phantom install is not an
 * option in an automated test - it needs a password to unlock, and typing a
 * password into a wallet is not something a test should do.
 *
 * So this implements the surface `PhantomWalletAdapter` actually calls, and
 * nothing else. The app's own wallet-adapter code runs completely unmodified:
 * it detects this the same way it detects a real extension, through the
 * adapter's polling strategy, and shows "Phantom DETECTED" in the picker.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a security boundary and not a real wallet. Keys are generated in the page
 * with WebCrypto and kept in localStorage so a reload does not need re-funding.
 * Use it against a LOCAL VALIDATOR only. Never load it against a page pointed at
 * mainnet, and never paste a real secret key into it.
 *
 * HOW TO USE
 * ----------
 *   1. Start a local validator and initialize config:
 *        npx dotenv-cli -e .env.e2e -- npx tsx scripts/e2e-init.mjs <VERIFIER_PUBKEY>
 *   2. Start the app against localnet:
 *        npx dotenv-cli -e .env.e2e -- npx next dev -p 4300
 *      Open it on http://localhost:4300 - NOT 127.0.0.1, which Next treats as a
 *      cross-origin dev request and refuses to hydrate.
 *   3. Seal a task to submit against:
 *        npx dotenv-cli -e .env.e2e -- npx tsx scripts/e2e-seed-open.mjs
 *   4. Paste this whole file into the browser console on the task page, then
 *      fund the address it prints:
 *        solana transfer <ADDRESS> 5 --allow-unfunded-recipient --url http://127.0.0.1:8899
 *   5. Drive the UI. Set `window.__mockWallet.__rejectNext = true` before an
 *      action to exercise the declined-signature branch.
 *
 * Inspect `__signMessageCalls` to see exactly what the wallet was asked to sign,
 * and `__signTxCalls` to count transaction approvals.
 */

(async () => {
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58enc = (bytes) => {
    const d = [0];
    for (const b of bytes) {
      let c = b;
      for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; }
      while (c) { d.push(c % 58); c = (c / 58) | 0; }
    }
    let out = "";
    for (const b of bytes) { if (b === 0) out += "1"; else break; }
    for (let i = d.length - 1; i >= 0; i--) out += B58[d[i]];
    return out;
  };
  const b58dec = (s) => {
    const d = [0];
    for (const ch of s) {
      let c = B58.indexOf(ch);
      for (let i = 0; i < d.length; i++) { c += d[i] * 58; d[i] = c & 0xff; c >>= 8; }
      while (c) { d.push(c & 0xff); c >>= 8; }
    }
    let lead = 0;
    for (const ch of s) { if (ch === "1") lead++; else break; }
    return new Uint8Array([...new Array(lead).fill(0), ...d.reverse()]);
  };

  // The 16-byte DER preamble for a PKCS#8-wrapped raw Ed25519 seed. WebCrypto
  // will only import a private key in that form, but exports the seed as the
  // last 32 bytes, so this is how a stored seed is loaded back.
  const PKCS8_ED25519_PREFIX = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ];

  let privateKey;
  let pubRaw;
  const storedSeed = localStorage.getItem("__mockSeed");
  if (storedSeed) {
    const pkcs8 = new Uint8Array([...PKCS8_ED25519_PREFIX, ...b58dec(storedSeed)]);
    privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
    pubRaw = b58dec(localStorage.getItem("__mockPub"));
  } else {
    const generated = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    privateKey = generated.privateKey;
    pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", generated.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey));
    localStorage.setItem("__mockSeed", b58enc(pkcs8.slice(-32)));
    localStorage.setItem("__mockPub", b58enc(pubRaw));
  }

  const rejection = () => {
    const error = new Error("User rejected the request.");
    error.code = 4001; // what a real wallet returns when someone clicks Reject
    return error;
  };

  const listeners = {};
  const wallet = {
    isPhantom: true,
    isConnected: false,
    publicKey: null,

    /** Set true to make the NEXT prompt be refused, as a person would. */
    __rejectNext: false,
    /** Every message the app asked this wallet to sign, as text. */
    __signMessageCalls: [],
    /** How many transactions were approved. */
    __signTxCalls: 0,

    async connect() {
      this.isConnected = true;
      this.publicKey = { toBytes: () => pubRaw, toString: () => b58enc(pubRaw) };
      (listeners.connect || []).forEach((fn) => fn(this.publicKey));
      return { publicKey: this.publicKey };
    },

    async disconnect() {
      this.isConnected = false;
      this.publicKey = null;
      (listeners.disconnect || []).forEach((fn) => fn());
    },

    on(event, fn) { (listeners[event] ||= []).push(fn); },
    off(event, fn) { listeners[event] = (listeners[event] || []).filter((f) => f !== fn); },

    async signMessage(message) {
      if (this.__rejectNext) { this.__rejectNext = false; throw rejection(); }
      this.__signMessageCalls.push(new TextDecoder().decode(message));
      return {
        signature: new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, message)),
        publicKey: this.publicKey,
      };
    },

    async signTransaction(tx) {
      if (this.__rejectNext) { this.__rejectNext = false; throw rejection(); }
      this.__signTxCalls++;
      const message = tx.message ? tx.message.serialize() : tx.serializeMessage();
      const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, message));
      // No Buffer in a browser. A legacy Transaction holds
      // { publicKey, signature } entries and serialize() accepts a Uint8Array.
      if (Array.isArray(tx.signatures) && tx.signatures[0] && "publicKey" in tx.signatures[0]) {
        tx.signatures[0].signature = signature;
      } else if (tx.signatures) {
        tx.signatures[0] = signature;
      }
      return tx;
    },

    async signAllTransactions(txs) {
      for (const tx of txs) await this.signTransaction(tx);
      return txs;
    },

    async signAndSendTransaction(tx, options) {
      if (this.__rejectNext) { this.__rejectNext = false; throw rejection(); }
      await this.signTransaction(tx);
      const raw = tx.serialize();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
      const response = await fetch("http://localhost:8899", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [base64, { encoding: "base64", preflightCommitment: "confirmed", ...(options || {}) }],
        }),
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error.message);
      return { signature: result.result };
    },
  };

  // How PhantomWalletAdapter detects an extension. It polls, so injecting after
  // the page has loaded is fine - the picker flips to DETECTED on its own.
  window.phantom = { solana: wallet };
  window.solana = wallet;
  window.isPhantomInstalled = true;

  window.__mockWallet = wallet;
  window.__mockAddress = b58enc(pubRaw);
  console.log("mock wallet ready:", window.__mockAddress);
  console.log("fund it:  solana transfer", window.__mockAddress,
    "5 --allow-unfunded-recipient --url http://127.0.0.1:8899");
  return window.__mockAddress;
})();
