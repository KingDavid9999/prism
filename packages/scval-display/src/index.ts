import { xdr, scValToNative } from "@stellar/stellar-sdk";

/**
 * ScVal display helpers shared by the frontend and the indexer. Both render
 * the same value through this module so a value reads identically whether it
 * came from live RPC or from indexed storage.
 */

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
  if (kind === "scvVec")
    return (val.vec() ?? []).map(scValToNativeKeepingMapKeys);
  return scValToNative(val);
}

/** Decode an XDR ScVal into a JSON-safe native JS value (bigints/bytes normalized to strings). Undefined if it can't be converted. */
export function decodeScVal(val: xdr.ScVal): unknown {
  try {
    return toDisplaySafe(scValToNativeKeepingMapKeys(val));
  } catch {
    return undefined;
  }
}

/**
 * Decode an ScVal to a compact, human-readable string for display.
 *
 * Contract-instance values have no plain-data form: the instance key and the
 * instance struct get fixed labels instead of a dump of the js-xdr class.
 */
export function scValToDisplay(val: xdr.ScVal): string {
  const switchName = val.switch().name;
  if (switchName === "scvVoid") return "void";
  if (switchName === "scvLedgerKeyContractInstance") return "__instance__";
  if (switchName === "scvContractInstance") return "(contract instance)";
  const decoded = decodeScVal(val);
  if (decoded === undefined) return "(unrepresentable value)";
  if (typeof decoded === "string") return decoded;
  try {
    return JSON.stringify(decoded) ?? "(unrepresentable value)";
  } catch {
    return "(unrepresentable value)";
  }
}
