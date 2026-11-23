/**
 * An unreachable RPC node must come back as an error on the invocation page,
 * not as an empty history. The SDK's RPC client is replaced with one whose
 * calls always fail, and the indexer is switched off so the RPC path runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class UnreachableServer {
    async getLatestLedger(): Promise<never> {
      throw new Error("RPC unreachable");
    }
    async getEvents(): Promise<never> {
      throw new Error("RPC unreachable");
    }
  }
  return { ...actual, rpc: { ...actual.rpc, Server: UnreachableServer } };
});

import { getInvocationHistoryPage } from "./soroban";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

describe("getInvocationHistoryPage without an indexer", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports the RPC error instead of an empty history", async () => {
    const page = await getInvocationHistoryPage(CONTRACT_ID, { limit: 20 });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.error).toContain("RPC unreachable");
  });
});
