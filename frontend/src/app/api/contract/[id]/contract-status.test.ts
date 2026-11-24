import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/soroban", () => ({
  getContractInfo: vi.fn(),
  getContractWasmInfo: vi.fn(),
}));
vi.mock("@/lib/indexed-db", () => ({
  getIndexedGaps: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn().mockReturnValue(null),
}));

import * as soroban from "@/lib/soroban";
import { GET as contractInfo } from "./route";
import { GET as wasm } from "./wasm/route";

const VALID_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const params = { params: { id: VALID_ID } };

function infoRequest() {
  return new Request(`http://localhost/api/contract/${VALID_ID}`);
}

function wasmRequest() {
  return new Request(`http://localhost/api/contract/${VALID_ID}/wasm`);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("contract lookup status mapping", () => {
  it.each([
    ["info", () => contractInfo(infoRequest(), params)],
    ["wasm", () => wasm(wasmRequest(), params)],
  ])(
    "GET /api/contract/[id]/%s returns 404 for a missing contract",
    async (_name, call) => {
      vi.mocked(soroban.getContractInfo).mockResolvedValueOnce({
        status: "missing",
      });
      const res = await call();
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Contract not found" });
    }
  );

  it.each([
    ["info", () => contractInfo(infoRequest(), params)],
    ["wasm", () => wasm(wasmRequest(), params)],
  ])(
    "GET /api/contract/[id]/%s returns 502 when RPC is unavailable",
    async (_name, call) => {
      vi.mocked(soroban.getContractInfo).mockResolvedValueOnce({
        status: "unavailable",
      });
      const res = await call();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: "Contract lookup unavailable",
      });
    }
  );
});
