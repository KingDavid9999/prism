import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/soroban", () => ({
  getContractInfo: vi.fn().mockResolvedValue({
    id: "test-id",
    name: "Test Contract",
  }),
  getInvocationHistoryPage: vi.fn().mockResolvedValue({
    items: [],
    nextCursor: null,
    error: null,
  }),
  simulateInvocation: vi.fn().mockResolvedValue({
    success: true,
    result: "mock-result",
  }),
  getContractWasmInfo: vi.fn().mockResolvedValue({
    types: [],
    functions: [{ name: "test_fn", inputs: [], outputs: [] }],
  }),
}));

vi.mock("@/lib/horizon", () => ({
  getLedger: vi.fn().mockResolvedValue({ sequence: 123, hash: "abc123" }),
  getTransaction: vi.fn().mockResolvedValue({
    hash: "txhash",
    envelopeXdr: "mock-xdr",
    fee: 100,
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/indexed-db", () => ({
  getIndexedGaps: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/strkey-validation", () => ({
  isContractId: vi.fn((id: string) => id.startsWith("C")),
}));

vi.mock("@/lib/history-cursor", () => ({
  parsePageRequest: vi.fn((url: URL) => {
    const cursor = url.searchParams.get("cursor");
    if (cursor === "bad-cursor") return null;
    return { cursor: null, limit: 10 };
  }),
}));

vi.mock("@/lib/contract-lists", () => ({
  INVOCATION_PAGE_SIZE: 10,
}));

vi.mock("@/lib/xdr", () => ({
  coerceArgInput: vi.fn((value: string) => value),
  decodeInvocation: vi.fn(() => null),
  getResourceUsage: vi.fn(() => null),
}));

vi.mock("@/lib/simulate-limits", () => ({
  simulateInputError: vi.fn(() => null),
  MAX_SIMULATE_BYTES: 1024 * 100,
}));

vi.mock("@stellar/stellar-sdk", () => ({
  xdr: {
    TransactionEnvelope: {
      fromXDR: vi.fn(() => ({})),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/contract/[id]", () => {
  it("returns 400 for an invalid contract ID", async () => {
    const { GET } = await import("./contract/[id]/route");
    const req = new Request("http://localhost/api/contract/invalid-id");
    const res = await GET(req, { params: { id: "invalid-id" } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid contract ID/i);
  });

  it("returns 200 for a valid contract ID", async () => {
    const { GET } = await import("./contract/[id]/route");
    const req = new Request("http://localhost/api/contract/CTEST123");
    const res = await GET(req, { params: { id: "CTEST123" } });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/contract/[id]/invocations", () => {
  it("returns 400 for a bad cursor", async () => {
    const { GET } = await import("./contract/[id]/invocations/route");
    const req = new Request(
      "http://localhost/api/contract/CTEST123/invocations?cursor=bad-cursor"
    );
    const res = await GET(req, { params: { id: "CTEST123" } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid cursor/i);
  });

  it("returns 200 for a valid request", async () => {
    const { GET } = await import("./contract/[id]/invocations/route");
    const req = new Request(
      "http://localhost/api/contract/CTEST123/invocations"
    );
    const res = await GET(req, { params: { id: "CTEST123" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("invocations");
  });
});

describe("GET /api/ledger/[seq]", () => {
  it("returns 400 for a non-numeric ledger sequence", async () => {
    const { GET } = await import("./ledger/[seq]/route");
    const req = new Request("http://localhost/api/ledger/abc");
    const res = await GET(req, { params: { seq: "abc" } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid ledger sequence/i);
  });

  it("returns 200 for a valid ledger sequence", async () => {
    const { GET } = await import("./ledger/[seq]/route");
    const req = new Request("http://localhost/api/ledger/123");
    const res = await GET(req, { params: { seq: "123" } });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/tx/[hash]", () => {
  it("returns 200 for a valid transaction hash", async () => {
    const { GET } = await import("./tx/[hash]/route");
    const req = new Request("http://localhost/api/tx/validhash");
    const res = await GET(req, { params: { hash: "validhash" } });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/contract/[id]/simulate", () => {
  it("returns 400 for an invalid simulate body", async () => {
    const { POST } = await import("./contract/[id]/simulate/route");
    const req = new Request("http://localhost/api/contract/CTEST123/simulate", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: { id: "CTEST123" } });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/functionName/i);
  });

  it("returns 200 for a valid simulate request", async () => {
    const { POST } = await import("./contract/[id]/simulate/route");
    const req = new Request("http://localhost/api/contract/CTEST123/simulate", {
      method: "POST",
      body: JSON.stringify({
        functionName: "test_fn",
        args: [],
      }),
    });
    const res = await POST(req, { params: { id: "CTEST123" } });
    expect(res.status).toBe(200);
  });
});
