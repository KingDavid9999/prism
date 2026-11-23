import { describe, expect, it } from "vitest";
import { Account, MuxedAccount, StrKey } from "@stellar/stellar-sdk";
import { splitMuxedAddress } from "./muxed";

const BASE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

function muxedOf(id: string): string {
  return new MuxedAccount(new Account(BASE, "0"), id).accountId();
}

describe("splitMuxedAddress", () => {
  it("returns the base G account and the muxed ID", () => {
    expect(splitMuxedAddress(muxedOf("42"))).toEqual({
      account: BASE,
      id: "42",
    });
  });

  it("keeps the full 64-bit ID", () => {
    expect(splitMuxedAddress(muxedOf("18446744073709551615"))?.id).toBe(
      "18446744073709551615"
    );
    expect(splitMuxedAddress(muxedOf("0"))?.id).toBe("0");
  });

  it("rejects an address with a corrupted checksum", () => {
    const m = muxedOf("42");
    const last = m.at(-1) === "A" ? "B" : "A";
    expect(splitMuxedAddress(m.slice(0, -1) + last)).toBeNull();
  });

  it("rejects a G address, a C address and malformed input", () => {
    expect(splitMuxedAddress(BASE)).toBeNull();
    expect(splitMuxedAddress("C" + "A".repeat(55))).toBeNull();
    expect(splitMuxedAddress(muxedOf("42").toLowerCase())).toBeNull();
    expect(splitMuxedAddress("M" + "A".repeat(10))).toBeNull();
    expect(splitMuxedAddress("")).toBeNull();
  });
});
