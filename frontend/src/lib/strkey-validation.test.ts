import { describe, expect, it } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import { isAccountId, isContractId } from "./strkey-validation";

const ACCOUNT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));

describe("isContractId", () => {
  it("accepts a valid C-address", () => {
    expect(isContractId(CONTRACT)).toBe(true);
  });

  it("rejects a short or garbage ID without a checksum match", () => {
    expect(isContractId("CABC")).toBe(false);
    expect(isContractId("hello")).toBe(false);
    expect(isContractId("")).toBe(false);
  });

  it("rejects a corrupted checksum and a G-address", () => {
    const last = CONTRACT.at(-1) === "A" ? "B" : "A";
    expect(isContractId(CONTRACT.slice(0, -1) + last)).toBe(false);
    expect(isContractId(ACCOUNT)).toBe(false);
  });
});

describe("isAccountId", () => {
  it("accepts a valid G-address", () => {
    expect(isAccountId(ACCOUNT)).toBe(true);
  });

  it("rejects a plain word, which is the case that used to reach Horizon", () => {
    expect(isAccountId("hello")).toBe(false);
    expect(isAccountId("")).toBe(false);
  });

  it("rejects a G-address with a corrupted checksum", () => {
    const last = ACCOUNT.at(-1) === "A" ? "B" : "A";
    expect(isAccountId(ACCOUNT.slice(0, -1) + last)).toBe(false);
  });

  it("rejects lower-case, contract and muxed addresses", () => {
    expect(isAccountId(ACCOUNT.toLowerCase())).toBe(false);
    expect(isAccountId(StrKey.encodeContract(Buffer.alloc(32, 9)))).toBe(false);
    expect(
      isAccountId(StrKey.encodeMed25519PublicKey(Buffer.alloc(40, 9)))
    ).toBe(false);
  });
});
