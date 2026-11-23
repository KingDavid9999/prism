import { NextResponse } from "next/server";
import { getContractWasmInfo, simulateInvocation } from "@/lib/soroban";
import { coerceArgInput } from "@/lib/xdr";
import { rateLimitRequest } from "@/lib/rate-limit";
import { isContractId } from "@/lib/strkey-validation";
import type { ContractFunctionSpec, ContractTypeDef } from "@/types";

export const dynamic = "force-dynamic";

/** A simulation is a function name and a few short arguments; anything much larger isn't a real call. */
const MAX_BODY_BYTES = 16 * 1024;

interface Params {
  params: { id: string };
}

interface SimulateBody {
  functionName?: string;
  /**
   * `type` is optional. When it is left out, the argument's type comes from the
   * function's declared signature in the contract's spec. When it is given, it
   * must agree with that signature.
   */
  args?: { value: string; type?: string }[];
  /**
   * Optional contract type definitions (structs, unions, enums) used to
   * coerce structured arguments correctly — the same path the UI takes via
   * the server action. When omitted, Prism fetches the types from the WASM
   * (using the cached result when available) so API callers get the same
   * coercion quality as the UI without having to supply the types themselves.
   */
  types?: ContractTypeDef[];
}

/**
 * Read the request body, giving up as soon as it passes `maxBytes` so an
 * oversized body is never buffered in full. Returns null when it is too large.
 */
async function readCappedBody(
  req: Request,
  maxBytes: number
): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Normalize a spec type for comparison: "Map<Symbol, U32>" and "map<symbol,u32>" name the same type. */
function normalizeType(type: string): string {
  return type.replace(/\s+/g, "").toLowerCase();
}

/**
 * The spec type to coerce argument `index` as. A type the caller leaves out is
 * taken from the declared signature. A type they give must match it, so a
 * wrong one fails here with a message that names the mismatch, not as a
 * confusing failure from the contract.
 */
function argumentType(
  functionName: string,
  index: number,
  given: string | undefined,
  declared: ContractFunctionSpec | undefined
): string {
  const expected = declared?.inputs[index]?.type;
  if (expected === undefined) {
    if (given === undefined) {
      throw new Error(
        `args[${index}] needs a type, because Prism couldn't read the signature of ${functionName} from this contract.`
      );
    }
    return given;
  }
  if (
    given !== undefined &&
    normalizeType(given) !== normalizeType(expected)
  ) {
    throw new Error(
      `args[${index}] is typed ${given}, but ${functionName} takes ${expected} there.`
    );
  }
  // The declared spelling, not the caller's: coercion matches user-defined
  // type names case-sensitively.
  return expected;
}

export async function POST(req: Request, { params }: Params) {
  const limited = rateLimitRequest(req, {
    scope: "contract-simulate",
    max: 10,
  });
  if (limited) return limited;
  if (!isContractId(params.id))
    return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });

  const raw = await readCappedBody(req, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  let body: SimulateBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.functionName) {
    return NextResponse.json(
      { error: "Missing required field: functionName" },
      { status: 400 }
    );
  }

  const functionName = body.functionName;
  const args = body.args ?? [];
  if (!Array.isArray(args)) {
    return NextResponse.json(
      { error: "args must be an array" },
      { status: 400 }
    );
  }

  // The contract's spec supplies the declared signature, which types any
  // argument the caller leaves untyped and checks the ones they do type. It is
  // read when there are arguments to type, and also for the type definitions
  // when the caller hasn't supplied them.
  let types: ContractTypeDef[] = body.types ?? [];
  let declared: ContractFunctionSpec | undefined;
  if (args.length > 0 || types.length === 0) {
    const wasm = await getContractWasmInfo(params.id);
    if (types.length === 0) types = wasm?.types ?? [];
    declared = wasm?.functions.find((f) => f.name === functionName);
  }
  if (declared && args.length > declared.inputs.length) {
    return NextResponse.json(
      {
        success: false,
        error: `${declared.name} takes ${declared.inputs.length} argument(s), but ${args.length} were given`,
      },
      { status: 400 }
    );
  }

  try {
    const scArgs = args.map((a, i) =>
      coerceArgInput(
        a.value,
        argumentType(functionName, i, a.type, declared),
        types
      )
    );
    const result = await simulateInvocation(params.id, functionName, scArgs);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Invalid arguments",
      },
      { status: 400 }
    );
  }
}
