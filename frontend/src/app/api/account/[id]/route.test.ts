import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const VALID_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

const getAccount = vi.fn();

vi.mock("@/lib/horizon", () => ({
  getAccount: (...args: unknown[]) => getAccount(...args),
  // Mirrors the real isNotFound: true only for a Horizon 404.
  isNotFound: (err: unknown) => (err as { status?: number })?.status === 404,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn().mockReturnValue(null),
}));

beforeEach(() => {
  getAccount.mockReset();
  getAccount.mockResolvedValue({ id: VALID_ID, sequence: "1", signerCount: 0 });
});

afterEach(() => {
  vi.resetModules();
});

function makeRequest(id: string) {
  return new Request(`http://localhost/api/account/${id}`);
}

describe("GET /api/account/[id]", () => {
  it("returns 200 with the AccountRecord for a valid account", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(VALID_ID), { params: { id: VALID_ID } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: VALID_ID });
  });

  it("returns 400 for an invalid account ID", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest("not-an-account"), {
      params: { id: "not-an-account" },
    });
    expect(res.status).toBe(400);
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("returns 404 when Horizon reports the account missing", async () => {
    getAccount.mockRejectedValue({ status: 404 });
    const { GET } = await import("./route");
    const res = await GET(makeRequest(VALID_ID), { params: { id: VALID_ID } });
    expect(res.status).toBe(404);
  });

  it("returns 502 when Horizon fails", async () => {
    getAccount.mockRejectedValue({ status: 503 });
    const { GET } = await import("./route");
    const res = await GET(makeRequest(VALID_ID), { params: { id: VALID_ID } });
    expect(res.status).toBe(502);
  });
});
