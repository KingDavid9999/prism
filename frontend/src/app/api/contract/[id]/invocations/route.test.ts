/**
 * Tests for GET /api/contract/[id]/invocations. An RPC failure must surface as
 * a 502 with the reason, not as an empty 200 that reads as "no invocations".
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/soroban", () => ({
  getInvocationHistoryPage: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => null),
}));

import { GET } from "./route";
import { getInvocationHistoryPage } from "@/lib/soroban";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const params = { params: { id: CONTRACT_ID } };
const url = `http://localhost/api/contract/${CONTRACT_ID}/invocations`;

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/contract/[id]/invocations", () => {
  it("returns 502 with the RPC error when the lookup fails", async () => {
    vi.mocked(getInvocationHistoryPage).mockResolvedValue({
      items: [],
      nextCursor: null,
      error: "connect ECONNREFUSED 127.0.0.1:8000",
    });

    const res = await GET(new Request(url), params);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      invocations: [],
      nextCursor: null,
      error: "connect ECONNREFUSED 127.0.0.1:8000",
    });
  });

  it("returns the page with a 200 when the lookup succeeds", async () => {
    const txHash = "a".repeat(64);
    vi.mocked(getInvocationHistoryPage).mockResolvedValue({
      items: [
        {
          txHash,
          ledger: 10,
          timestamp: "2026-11-23T00:00:00.000Z",
          successful: true,
        },
      ],
      nextCursor: null,
      error: null,
    });

    const res = await GET(new Request(url), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      invocations: [{ txHash, ledger: 10 }],
      nextCursor: null,
      error: null,
    });
  });
});
