import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/horizon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/horizon")>();
  return {
    ...actual,
    getLedger: vi.fn().mockResolvedValue({ sequence: 12, hash: "abc" }),
  };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn().mockReturnValue(null),
}));

import { getLedger, HorizonError } from "@/lib/horizon";

afterEach(() => {
  vi.resetModules();
});

function makeRequest(seq: string) {
  return new Request(`http://localhost/api/ledger/${seq}`);
}

describe("GET /api/ledger/[seq] (issue #31 — reject non-numeric sequences)", () => {
  it("accepts a plain integer", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("12"), { params: { seq: "12" } });
    expect(res.status).toBe(200);
  });

  it("rejects a value with trailing text (12abc)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("12abc"), { params: { seq: "12abc" } });
    expect(res.status).toBe(400);
  });

  it("rejects scientific notation (1e9)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("1e9"), { params: { seq: "1e9" } });
    expect(res.status).toBe(400);
  });

  it("rejects a value that exceeds uint32 max", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("4294967296"), {
      params: { seq: "4294967296" },
    });
    expect(res.status).toBe(400);
  });

  it("accepts the uint32 max value", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("4294967295"), {
      params: { seq: "4294967295" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a negative number", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("-1"), { params: { seq: "-1" } });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/ledger/[seq] Horizon failures", () => {
  it("returns 404 only when Horizon reports the ledger missing", async () => {
    vi.mocked(getLedger).mockRejectedValueOnce(
      new HorizonError(404, "/ledgers/12")
    );
    const { GET } = await import("./route");
    const res = await GET(makeRequest("12"), { params: { seq: "12" } });
    expect(res.status).toBe(404);
  });

  it.each([
    ["a Horizon 503", new HorizonError(503, "/ledgers/12")],
    ["a timeout", new Error("The operation timed out")],
  ])("returns 502 for %s", async (_name, error) => {
    vi.mocked(getLedger).mockRejectedValueOnce(error);
    const { GET } = await import("./route");
    const res = await GET(makeRequest("12"), { params: { seq: "12" } });
    expect(res.status).toBe(502);
  });
});
