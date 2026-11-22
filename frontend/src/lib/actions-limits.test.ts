/**
 * Tests for the server actions' limits: the per-client rate limit (#227).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(() => new Headers()) }));
vi.mock("./soroban", () => ({
  lookupStorageEntry: vi.fn(),
  parseStorageKeyInput: vi.fn(() => ({ kind: "key" })),
  simulateInvocation: vi.fn(),
}));
vi.mock("./xdr", () => ({
  coerceArgInput: vi.fn(),
  decodeAnyXdr: vi.fn().mockReturnValue(null),
}));

import { headers } from "next/headers";
import {
  decodeXdrAction,
  lookupStorageKeyAction,
  simulateInvocationAction,
} from "./actions";
import { simulateInvocation } from "./soroban";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

/**
 * Makes subsequent action calls come from `ip`. Each test uses its own IP, so
 * one test's calls don't spend another test's allowance.
 */
function useClient(ip: string): void {
  vi.mocked(headers).mockReturnValue(
    new Headers({ "x-forwarded-for": ip }) as unknown as ReturnType<
      typeof headers
    >
  );
}

beforeEach(() => {
  // Read the client IP from x-forwarded-for, as behind a trusted proxy.
  process.env.TRUST_PROXY = "1";
  vi.mocked(simulateInvocation).mockResolvedValue({ success: true });
});

afterEach(() => {
  delete process.env.TRUST_PROXY;
  vi.clearAllMocks();
});

describe("server actions are rate-limited (#227)", () => {
  it("refuses the 11th simulation in a minute without calling RPC", async () => {
    useClient("203.0.113.10");
    for (let i = 0; i < 10; i++) {
      const ok = await simulateInvocationAction(CONTRACT_ID, "bump", []);
      expect(ok.success).toBe(true);
    }

    const blocked = await simulateInvocationAction(CONTRACT_ID, "bump", []);
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/rate limit/i);
    expect(simulateInvocation).toHaveBeenCalledTimes(10);
  });

  it("limits storage lookups per client", async () => {
    useClient("203.0.113.11");
    for (let i = 0; i < 30; i++) {
      await lookupStorageKeyAction(CONTRACT_ID, "symbol", "k", "persistent");
    }

    const blocked = await lookupStorageKeyAction(
      CONTRACT_ID,
      "symbol",
      "k",
      "persistent"
    );
    expect(blocked).toHaveProperty("error");
    expect((blocked as { error: string }).error).toMatch(/rate limit/i);
  });

  it("limits XDR decodes per client", async () => {
    useClient("203.0.113.12");
    for (let i = 0; i < 30; i++) {
      await decodeXdrAction("AAAA");
    }

    const blocked = await decodeXdrAction("AAAA");
    expect((blocked as { error: string }).error).toMatch(/rate limit/i);
  });

  it("keeps clients apart: a second client is not blocked by the first", async () => {
    useClient("203.0.113.13");
    for (let i = 0; i < 10; i++) {
      await simulateInvocationAction(CONTRACT_ID, "bump", []);
    }

    useClient("203.0.113.14");
    const other = await simulateInvocationAction(CONTRACT_ID, "bump", []);
    expect(other.success).toBe(true);
  });
});
