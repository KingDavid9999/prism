import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./soroban", () => ({
  lookupStorageEntry: vi.fn(),
  parseStorageKeyInput: vi.fn(() => ({ kind: "key" })),
  simulateInvocation: vi.fn(),
}));
vi.mock("./xdr", () => ({
  coerceArgInput: vi.fn(),
  decodeAnyXdr: vi.fn(),
}));

import { lookupStorageKeyAction } from "./actions";
import { lookupStorageEntry, parseStorageKeyInput } from "./soroban";
import type { ContractTypeDef } from "@/types";
import { StrKey } from "@stellar/stellar-sdk";

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));

describe("lookupStorageKeyAction — contract ID validation", () => {
  it("rejects a malformed contract ID before any RPC call", async () => {
    const result = await lookupStorageKeyAction(
      "CABC",
      "DataKey",
      "Admin",
      "persistent"
    );
    expect(result).toEqual({ error: "Invalid contract ID" });
    expect(lookupStorageEntry).not.toHaveBeenCalled();
  });
});

const types: ContractTypeDef[] = [
  {
    kind: "union",
    name: "DataKey",
    cases: [{ name: "Note", types: ["Symbol"] }],
  },
];

afterEach(() => vi.clearAllMocks());

describe("lookupStorageKeyAction — contract types", () => {
  it("forwards the contract's type definitions when coercing the key", async () => {
    vi.mocked(lookupStorageEntry).mockResolvedValue({
      key: "note",
      value: "hello",
      durability: "persistent",
      liveUntilLedgerSeq: 555,
    });

    await expect(
      lookupStorageKeyAction(
        CONTRACT_ID,
        "DataKey",
        '{"Note":["hello"]}',
        "persistent",
        types
      )
    ).resolves.toMatchObject({ liveUntilLedgerSeq: 555 });

    expect(parseStorageKeyInput).toHaveBeenCalledWith(
      '{"Note":["hello"]}',
      "DataKey",
      types
    );
  });

  it("rejects an empty key before touching the RPC", async () => {
    const result = await lookupStorageKeyAction(
      CONTRACT_ID,
"symbol",
      "  ",
      "persistent"
    );
    expect(result).toHaveProperty("error");
    expect(lookupStorageEntry).not.toHaveBeenCalled();
  });
});
