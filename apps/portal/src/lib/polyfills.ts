// Browser polyfills. @solana/web3.js (transaction deserialization) expects a
// Node-style global `Buffer`; Vite doesn't shim it, so we install it once at
// app startup before anything touches web3.js.
import { Buffer as BrowserBuffer } from "buffer/";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = BrowserBuffer as unknown as typeof globalThis.Buffer;
}
