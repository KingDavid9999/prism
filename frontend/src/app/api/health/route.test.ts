import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockGetHealth } = vi.hoisted(() => ({
  mockGetHealth: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: class {
      getHealth = mockGetHealth;
    },
  },
}));

vi.mock("@/lib/indexed-db", () => ({
  isIndexerConfigured: vi.fn(),
  checkDatabaseHealth: vi.fn(),
}));

import { isIndexerConfigured, checkDatabaseHealth } from "@/lib/indexed-db";
import { GET } from "./route";

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetHealth.mockResolvedValue({ status: "healthy" });
  vi.mocked(isIndexerConfigured).mockReturnValue(true);
  vi.mocked(checkDatabaseHealth).mockResolvedValue(true);
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
  } as Response);
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("GET /api/health", () => {
  it("returns 200 { status: 'ok' } cheaply without hitting external dependencies", async () => {
    const req = new Request("http://localhost:3000/api/health");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetHealth).not.toHaveBeenCalled();
    expect(checkDatabaseHealth).not.toHaveBeenCalled();
  });

  it("returns 200 with all dependencies ok when deep=1 and everything is healthy", async () => {
    const req = new Request("http://localhost:3000/api/health?deep=1");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.dependencies).toEqual({
      horizon: "ok",
      rpc: "ok",
      database: "ok",
    });
  });

  it("marks database as skipped when indexer is not configured", async () => {
    vi.mocked(isIndexerConfigured).mockReturnValue(false);

    const req = new Request("http://localhost:3000/api/health?deep=1");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.dependencies.database).toBe("skipped");
    expect(checkDatabaseHealth).not.toHaveBeenCalled();
  });

  it("returns 503 when Horizon fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
    } as Response);

    const req = new Request("http://localhost:3000/api/health?deep=1");
    const res = await GET(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.failed).toContain("horizon");
    expect(body.dependencies.horizon).toContain("502");
  });

  it("returns 503 when Horizon throws an exception", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const req = new Request("http://localhost:3000/api/health?deep=1");
    const res = await GET(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.failed).toContain("horizon");
  });

  it("returns 503 when Soroban RPC fails", async () => {
    mockGetHealth.mockResolvedValue({ status: "degraded" });

    const req = new Request("http://localhost:3000/api/health?deep=1");
    const res = await GET(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.failed).toContain("rpc");
  });

  it("returns 503 when Database fails", async () => {
    vi.mocked(checkDatabaseHealth).mockResolvedValue(false);

    const req = new Request("http://localhost:3000/api/health?deep=1");
    const res = await GET(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.failed).toContain("database");
  });
});
