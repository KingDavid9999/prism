import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/horizon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/horizon")>();
  return {
    ...actual,
    getTransaction: vi.fn(),
  };
});

vi.mock("@/lib/soroban", () => ({
  getInvocationReturnValue: vi.fn(),
}));

vi.mock("@/lib/xdr", () => ({
  decodeInvocation: vi.fn(),
  getResourceUsage: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn().mockReturnValue(null),
}));

import { getTransaction, HorizonError } from "@/lib/horizon";
import { GET } from "./route";

const HASH = "a".repeat(64);

function makeRequest(hash: string) {
  return new Request(`http://localhost/api/tx/${hash}`);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tx/[hash]", () => {
  it.each(["abc", "../ledgers/1", "..%2Fledgers%2F1"])(
    "rejects invalid hash %s without calling Horizon",
    async (hash) => {
      const res = await GET(makeRequest(hash), { params: { hash } });
      expect(res.status).toBe(400);
      expect(getTransaction).not.toHaveBeenCalled();
    }
  );

  it("returns 404 when Horizon reports the transaction missing", async () => {
    vi.mocked(getTransaction).mockRejectedValueOnce(
      new HorizonError(404, `/transactions/${HASH}`)
    );
    const res = await GET(makeRequest(HASH), { params: { hash: HASH } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Transaction not found" });
  });

  it.each([
    ["a Horizon 503", new HorizonError(503, `/transactions/${HASH}`)],
    ["a timeout", new Error("The operation timed out")],
  ])("returns 502 for %s", async (_name, error) => {
    vi.mocked(getTransaction).mockRejectedValueOnce(error);
    const res = await GET(makeRequest(HASH), { params: { hash: HASH } });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Transaction lookup unavailable",
    });
  });
});
