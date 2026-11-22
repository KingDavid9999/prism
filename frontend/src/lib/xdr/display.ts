import { xdr, scValToNative } from "@stellar/stellar-sdk";

function toDisplaySafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(toDisplaySafe);
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries()).map(([k, v]) => [
        String(toDisplaySafe(k)),
        toDisplaySafe(v),
      ])
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        toDisplaySafe(v),
      ])
    );
  }
  return value;
}

/**
 * scValToNative turns a map into a plain object keyed by String(key), so two
 * keys that stringify alike collapse before toDisplaySafe sees them. Map and
 * vec nodes are converted here instead, so every key survives.
 */
function scValToNativeKeepingMapKeys(val: xdr.ScVal): unknown {
  const kind = val.switch().name;
  if (kind === "scvMap") {
    return new Map(
      (val.map() ?? []).map((e): [unknown, unknown] => [
        scValToNativeKeepingMapKeys(e.key()),
        scValToNativeKeepingMapKeys(e.val()),
      ])
    );
  }
  if (kind === "scvVec") return (val.vec() ?? []).map(scValToNativeKeepingMapKeys);
  return scValToNative(val);
}

/** Decode an XDR ScVal into a JSON-safe native JS value (bigints/bytes normalized to strings). */
export function decodeScVal(val: xdr.ScVal): unknown {
  try {
    return toDisplaySafe(scValToNativeKeepingMapKeys(val));
  } catch {
    return undefined;
  }
}

/** Decode an XDR ScVal to a compact, human-readable string for display. */
export function scValToDisplay(val: xdr.ScVal): string {
  if (val.switch().name === "scvVoid") return "void";
  const decoded = decodeScVal(val);
  if (decoded === undefined) return "(unrepresentable value)";
  return typeof decoded === "string" ? decoded : JSON.stringify(decoded);
}

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
