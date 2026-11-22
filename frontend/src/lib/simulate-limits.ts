import type { ContractTypeDef } from "@/types";

/**
 * Size limits for a simulation's inputs (#228). The /simulate route and the
 * simulateInvocationAction server action both use these, so each rejects the
 * same oversized calls.
 */

/** A simulation is a function name and a few short arguments; anything much larger isn't a real call. */
export const MAX_SIMULATE_BYTES = 16 * 1024;

/**
 * The most arguments one simulation may pass. A judgment call: the XDR spec
 * itself sets no bound, and real contract functions take far fewer.
 */
export const MAX_SIMULATE_ARGS = 32;

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

/**
 * Why a simulation's inputs are too large, or null when they fit. Callers
 * reject the call with this message before any RPC request is made.
 */
export function simulateInputError(
  args: { value: string }[],
  types: ContractTypeDef[]
): string | null {
  if (args.length > MAX_SIMULATE_ARGS) {
    return `A simulation takes at most ${MAX_SIMULATE_ARGS} arguments, but ${args.length} were given.`;
  }
  const oversized = args.findIndex(
    (arg) => byteLength(arg.value) > MAX_SIMULATE_BYTES
  );
  if (oversized !== -1) {
    return `args[${oversized}] is larger than ${MAX_SIMULATE_BYTES / 1024} KB.`;
  }
  if (byteLength(JSON.stringify(types)) > MAX_SIMULATE_BYTES) {
    return `types is larger than ${MAX_SIMULATE_BYTES / 1024} KB.`;
  }
  return null;
}
