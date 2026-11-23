/**
 * Tests for GET /api/contract/[id]/storage with a u32 key. Unlike the route
 * tests that mock @/lib/soroban, these run the real key parser, so the 400s
 * come from the same validation the server applies to every request.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => null),
}));
vi.mock("@/lib/soroban", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soroban")>()),
  lookupStorageEntry: vi.fn(async () => null),
}));

import { GET } from "./route";
import { lookupStorageEntry } from "@/lib/soroban";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

function getWithU32Key(key: string): Promise<Response> {
  const url = `http://localhost/api/contract/${CONTRACT_ID}/storage?kind=u32&key=${encodeURIComponent(key)}`;
  return GET(new Request(url), { params: { id: CONTRACT_ID } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/contract/[id]/storage with a u32 key", () => {
  it.each(["abc", "1.5", "5000000000"])(
    "returns 400 for %s, which is not a whole number in u32 range",
    async (key) => {
      const res = await getWithU32Key(key);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("not a valid U32");
      expect(lookupStorageEntry).not.toHaveBeenCalled();
    }
  );

  it("passes an in-range integer on to the lookup", async () => {
    const res = await getWithU32Key("7");
    expect(res.status).toBe(404);
    const [, scKey] = vi.mocked(lookupStorageEntry).mock.calls[0];
    expect(scKey.switch().name).toBe("scvU32");
  });
});
