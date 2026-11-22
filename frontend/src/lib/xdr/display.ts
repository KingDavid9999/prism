import { xdr } from "@stellar/stellar-sdk";
import { decodeScVal, scValToDisplay } from "@prism/scval-display";

// The display helpers live in the shared package so the indexer renders the
// same string for the same value. Re-exported for the rest of the frontend.
export { decodeScVal, scValToDisplay };

/**
 * The ScVal kind of a value as a short tag, e.g. "u32", "symbol", "address".
 * Kept apart from scValToDisplay so the compact string stays the same for tables.
 */
export function scValTypeLabel(val: xdr.ScVal): string {
  const name = val.switch().name.replace(/^scv/, "");
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Decode a base64-encoded ScVal XDR string to a display string. Falls back to the raw base64 on failure. */
export function decodeXdr(xdrBase64: string): string {
  try {
    return scValToDisplay(xdr.ScVal.fromXDR(xdrBase64, "base64"));
  } catch {
    return xdrBase64;
  }
}

/** Decode a base64-encoded ScVal XDR string to a native JS value. */
export function decodeScValXdr(xdrBase64: string): unknown {
  try {
    return decodeScVal(xdr.ScVal.fromXDR(xdrBase64, "base64"));
  } catch {
    return undefined;
  }
}
