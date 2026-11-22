/**
 * Tests for the simulate route's contract type support (#30).
 *
 * Verifies that the POST /api/contract/[id]/simulate endpoint:
 *   - accepts an optional `types` array and passes it to coerceArgInput
 *   - fetches types from the WASM (via getContractWasmInfo) when none are
 *     supplied by the caller
 *   - still works when no types are available at all (primitive-only args)
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/soroban", () => ({
  simulateInvocation: vi.fn(),
  getContractWasmInfo: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => null),
}));
vi.mock("@/lib/xdr", () => ({
  coerceArgInput: vi.fn((value: string) => ({ type: "scvString", value })),
}));

import { POST } from "./route";
import { simulateInvocation, getContractWasmInfo } from "@/lib/soroban";
import { coerceArgInput } from "@/lib/xdr";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

function makeRequest(body: unknown): Request {
  return new Request(`http://localhost/api/contract/${CONTRACT_ID}/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: { id: CONTRACT_ID } };

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/contract/[id]/simulate — type definitions (#30)", () => {
  it("returns 400 when functionName is missing", async () => {
    const res = await POST(makeRequest({}), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/functionName/i);
  });

  it("uses caller-supplied types when they are present", async () => {
    const callerTypes = [
      {
        kind: "struct" as const,
        name: "MyStruct",
        fields: [{ name: "amount", type: "u64" }],
      },
    ];
    vi.mocked(simulateInvocation).mockResolvedValue({
      success: true,
      returnValue: "ok",
    });

    await POST(
      makeRequest({
        functionName: "transfer",
        args: [{ value: "42", type: "u64" }],
        types: callerTypes,
      }),
      params
    );

    expect(coerceArgInput).toHaveBeenCalledWith("42", "u64", callerTypes);
    // The WASM is read to check the typed argument against the declared
    // signature, but the caller's type definitions are the ones used.
    expect(getContractWasmInfo).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it("fetches types from the WASM when no types are supplied by the caller", async () => {
    const wasmTypes = [
      {
        kind: "enum" as const,
        name: "Status",
        cases: [{ name: "Active", value: 1 }],
      },
    ];
    vi.mocked(getContractWasmInfo).mockResolvedValue({
      size: 100,
      functions: [],
      events: [],
      types: wasmTypes,
    });
    vi.mocked(simulateInvocation).mockResolvedValue({ success: true });

    await POST(
      makeRequest({
        functionName: "check",
        args: [{ value: "1", type: "u32" }],
      }),
      params
    );

    expect(getContractWasmInfo).toHaveBeenCalledWith(CONTRACT_ID);
    expect(coerceArgInput).toHaveBeenCalledWith("1", "u32", wasmTypes);
  });

  it("falls back to an empty types list when getContractWasmInfo returns null", async () => {
    vi.mocked(getContractWasmInfo).mockResolvedValue(null);
    vi.mocked(simulateInvocation).mockResolvedValue({ success: true });

    await POST(makeRequest({ functionName: "hello" }), params);

    expect(coerceArgInput).not.toHaveBeenCalled(); // no args
    expect(simulateInvocation).toHaveBeenCalledWith(CONTRACT_ID, "hello", []);
  });

  it("returns 200 with the simulation result on success", async () => {
    vi.mocked(getContractWasmInfo).mockResolvedValue(null);
    vi.mocked(simulateInvocation).mockResolvedValue({
      success: true,
      returnValue: "42",
      instructions: 1000,
    });

    const res = await POST(makeRequest({ functionName: "get_value" }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.returnValue).toBe("42");
  });
});

describe("POST /api/contract/[id]/simulate — argument types from the spec (#233)", () => {
  const bump = {
    name: "bump",
    inputs: [{ name: "by", type: "u32" }],
    outputs: ["u32"],
  };

  function declareFunctions(functions: (typeof bump)[]) {
    vi.mocked(getContractWasmInfo).mockResolvedValue({
      size: 100,
      functions,
      events: [],
      types: [],
    });
  }

  it("takes an argument's type from the declared signature when none is given", async () => {
    declareFunctions([bump]);
    vi.mocked(simulateInvocation).mockResolvedValue({
      success: true,
      returnValue: "4",
    });

    const res = await POST(
      makeRequest({ functionName: "bump", args: [{ value: "3" }] }),
      params
    );

    expect(res.status).toBe(200);
    expect(coerceArgInput).toHaveBeenCalledWith("3", "u32", []);
    expect(simulateInvocation).toHaveBeenCalledWith(CONTRACT_ID, "bump", [
      { type: "scvString", value: "3" },
    ]);
  });

  it("uses the declared spelling when a given type differs only in case or spacing", async () => {
    declareFunctions([
      {
        name: "tally",
        inputs: [{ name: "amounts", type: "Vec<Symbol>" }],
        outputs: [],
      },
    ]);
    vi.mocked(simulateInvocation).mockResolvedValue({ success: true });

    const res = await POST(
      makeRequest({
        functionName: "tally",
        args: [{ value: '["a"]', type: "vec< symbol >" }],
      }),
      params
    );

    expect(res.status).toBe(200);
    expect(coerceArgInput).toHaveBeenCalledWith('["a"]', "Vec<Symbol>", []);
  });

  it("rejects a given type that disagrees with the signature, before simulating", async () => {
    declareFunctions([bump]);

    const res = await POST(
      makeRequest({
        functionName: "bump",
        args: [{ value: "3", type: "U64" }],
      }),
      params
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("args[0] is typed U64, but bump takes u32 there.");
    expect(simulateInvocation).not.toHaveBeenCalled();
  });

  it("rejects more arguments than the function declares", async () => {
    declareFunctions([bump]);

    const res = await POST(
      makeRequest({
        functionName: "bump",
        args: [{ value: "3" }, { value: "4" }],
      }),
      params
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/takes 1 argument\(s\), but 2 were given/);
    expect(simulateInvocation).not.toHaveBeenCalled();
  });

  it("asks for a type when an argument has none and the signature can't be read", async () => {
    vi.mocked(getContractWasmInfo).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ functionName: "bump", args: [{ value: "3" }] }),
      params
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/args\[0\] needs a type/);
    expect(simulateInvocation).not.toHaveBeenCalled();
  });

  // Issue #228 — the route and the action share one argument-count cap.
  it("rejects more arguments than the shared cap, before reading the contract", async () => {
    const args = Array.from({ length: 33 }, () => ({ value: "1", type: "u32" }));

    const res = await POST(
      makeRequest({ functionName: "bump", args }),
      params
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/at most 32 arguments, but 33 were given/);
    expect(getContractWasmInfo).not.toHaveBeenCalled();
    expect(simulateInvocation).not.toHaveBeenCalled();
  });
});
