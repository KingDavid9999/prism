/**
 * A single page view must not perform the same contract-instance lookup three
 * times (generateMetadata, the page, and getContractWasmInfo). See the
 * request-scoped cache in ./request-cache.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { rpc, StrKey } from "@stellar/stellar-sdk";

vi.mock("./indexed-db", () => ({
  isIndexerConfigured: vi.fn(() => false),
  getIndexedContract: vi.fn().mockResolvedValue(null),
  getIndexedEvents: vi.fn(),
  getIndexedInvocations: vi.fn(),
  getIndexedStorageEntries: vi.fn(),
  getIndexedInvocationReturnValue: vi.fn(),
}));

import { getContractInfo, getContractWasmInfo } from "./soroban";
import { runWithCacheScope } from "./request-cache";
import { getIndexedContract } from "./indexed-db";

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

function instanceData() {
  return {
    val: {
      contractData: () => ({
        val: () => ({
          instance: () => ({
            executable: () => ({
              switch: () => ({ name: "contractExecutableWasm" }),
              wasmHash: () => Buffer.alloc(32, 1),
            }),
            storage: () => [],
          }),
        }),
      }),
    },
    liveUntilLedgerSeq: 1000,
    lastModifiedLedgerSeq: 500,
  } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("getContractInfo request cache", () => {
  it("performs one instance lookup per page view", async () => {
    const getLedgerEntries = vi
      .spyOn(rpc.Server.prototype, "getLedgerEntries")
      .mockResolvedValue({
        entries: [instanceData()],
        latestLedger: 1000,
      } as never);
    vi.spyOn(
      rpc.Server.prototype,
      "getContractWasmByContractId"
    ).mockResolvedValue(Buffer.alloc(64) as never);

    await runWithCacheScope(async () => {
      // generateMetadata()
      await getContractInfo(CONTRACT_ID);
      // ContractPage(), which passes the info through to the WASM helper
      const result = await getContractInfo(CONTRACT_ID);
      await getContractWasmInfo(
        CONTRACT_ID,
        result.status === "found" ? result.info : null
      );
    });

    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(getIndexedContract).toHaveBeenCalledTimes(1);
  });

  it("shares one lookup even when callers do not pass the info through", async () => {
    const getLedgerEntries = vi
      .spyOn(rpc.Server.prototype, "getLedgerEntries")
      .mockResolvedValue({
        entries: [instanceData()],
        latestLedger: 1000,
      } as never);
    vi.spyOn(
      rpc.Server.prototype,
      "getContractWasmByContractId"
    ).mockResolvedValue(Buffer.alloc(64) as never);

    await runWithCacheScope(async () => {
      await Promise.all([
        getContractInfo(CONTRACT_ID),
        getContractInfo(CONTRACT_ID),
        getContractWasmInfo(CONTRACT_ID),
      ]);
    });

    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
    expect(getIndexedContract).toHaveBeenCalledTimes(1);
  });

  it("does not leak cached results into a different request", async () => {
    const getLedgerEntries = vi
      .spyOn(rpc.Server.prototype, "getLedgerEntries")
      .mockResolvedValue({
        entries: [instanceData()],
        latestLedger: 1000,
      } as never);

    await runWithCacheScope(() => getContractInfo(CONTRACT_ID));
    await runWithCacheScope(() => getContractInfo(CONTRACT_ID));

    expect(getLedgerEntries).toHaveBeenCalledTimes(2);
  });
});
