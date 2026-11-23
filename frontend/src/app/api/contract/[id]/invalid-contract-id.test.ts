/**
 * Every contract API route rejects a malformed contract ID with a 400 before
 * any RPC call, so a garbage path never costs a round trip to the network.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/soroban", () => ({
  getContractInfo: vi.fn(),
  getContractEventsPage: vi.fn(),
  getInvocationHistoryPage: vi.fn(),
  getContractWasmInfo: vi.fn(),
  simulateInvocation: vi.fn(),
  lookupStorageEntry: vi.fn(),
  parseStorageKeyInput: vi.fn(),
  getFullStorageEntries: vi.fn(),
  SIMPLE_STORAGE_KEY_KINDS: ["symbol", "string", "u32", "address"],
}));
vi.mock("@/lib/indexed-db", () => ({
  getIndexedGaps: vi.fn(),
  isIndexerConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => null),
}));
vi.mock("@/lib/xdr", () => ({
  coerceArgInput: vi.fn(),
}));

import * as soroban from "@/lib/soroban";
import { GET as contractInfo } from "./route";
import { GET as events } from "./events/route";
import { GET as invocations } from "./invocations/route";
import { POST as simulate } from "./simulate/route";
import { GET as storage } from "./storage/route";
import { GET as storageFull } from "./storage/full/route";
import { GET as wasm } from "./wasm/route";

const BAD_ID = "CABC";
const params = { params: { id: BAD_ID } };

function url(path: string): string {
  return `http://localhost/api/contract/${BAD_ID}${path}`;
}

const routes: [string, () => Promise<Response>][] = [
  ["GET /api/contract/[id]", () => contractInfo(new Request(url("")), params)],
  ["GET /events", () => events(new Request(url("/events")), params)],
  [
    "GET /invocations",
    () => invocations(new Request(url("/invocations")), params),
  ],
  [
    "POST /simulate",
    () =>
      simulate(
        new Request(url("/simulate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ functionName: "hello" }),
        }),
        params
      ),
  ],
  [
    "GET /storage",
    () => storage(new Request(url("/storage?key=Admin&kind=symbol")), params),
  ],
  [
    "GET /storage/full",
    () => storageFull(new Request(url("/storage/full")), params),
  ],
  ["GET /wasm", () => wasm(new Request(url("/wasm")), params)],
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("contract routes reject a malformed contract ID", () => {
  it.each(routes)(
    "%s returns 400 and makes no RPC call",
    async (_name, call) => {
      const res = await call();
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid contract ID" });
      for (const fn of Object.values(soroban)) {
        if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
      }
    }
  );
});
