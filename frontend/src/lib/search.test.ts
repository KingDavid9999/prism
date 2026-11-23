import { describe, expect, it } from "vitest";
import { Account, MuxedAccount, StrKey } from "@stellar/stellar-sdk";
import { resolveSearchRoute } from "./search";

const TX = "a".repeat(64);
const CONTRACT = "C" + "A".repeat(55);
const ACCOUNT = "G" + "A".repeat(55);
const MUXED_BASE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const MUXED = new MuxedAccount(new Account(MUXED_BASE, "0"), "1234").accountId();

const TESTNET = "Test SDF Network ; September 2015";
const MAINNET = "Public Global Stellar Network ; September 2015";
const ISSUER = Keypair.random().publicKey();

describe("resolveSearchRoute", () => {
  it("routes a 64-char hex string to /tx", () => {
    expect(resolveSearchRoute(TX)).toBe(`/tx/${TX}`);
  });

  it("routes an upper-case hash to /tx in lowercase", () => {
    expect(resolveSearchRoute("A".repeat(64))).toBe(`/tx/${"a".repeat(64)}`);
    expect(resolveSearchRoute("AbCdEf" + "0".repeat(58))).toBe(
      `/tx/abcdef${"0".repeat(58)}`
    );
  });

  it("routes a C-strkey to /contract", () => {
    expect(resolveSearchRoute(CONTRACT)).toBe(`/contract/${CONTRACT}`);
  });

  it("routes a G-strkey to /account", () => {
    expect(resolveSearchRoute(ACCOUNT)).toBe(`/account/${ACCOUNT}`);
  });

  it("routes a valid M-address to its base G account with the muxed ID", () => {
    expect(resolveSearchRoute(MUXED)).toBe(`/account/${MUXED_BASE}?muxed=1234`);
  });

  it("does not route a corrupted M-address as an account", () => {
    const last = MUXED.at(-1) === "A" ? "B" : "A";
    const bad = MUXED.slice(0, -1) + last;
    expect(resolveSearchRoute(bad)).toBe(`/search?q=${encodeURIComponent(bad)}`);
  });

  it("routes a decimal string to /ledger", () => {
    expect(resolveSearchRoute("1234567")).toBe("/ledger/1234567");
  });

  it("routes an unrecognised query to /search", () => {
    expect(resolveSearchRoute("hello world")).toBe("/search?q=hello%20world");
  });

  it("rejects a 56-char string starting with C but containing non-base32 chars", () => {
    // Lowercase letters are not valid base-32 — should fall through to /search
    const bad = "C" + "a".repeat(55);
    expect(resolveSearchRoute(bad)).toBe(
      `/search?q=${encodeURIComponent(bad)}`
    );
  });

  it("rejects a 56-char string starting with C but wrong length", () => {
    const short = "C" + "A".repeat(50);
    expect(resolveSearchRoute(short)).toBe(
      `/search?q=${encodeURIComponent(short)}`
    );
  });

  it("trims whitespace before routing", () => {
    expect(resolveSearchRoute("  " + TX + "  ")).toBe(`/tx/${TX}`);
  });

  it("returns null for empty input", () => {
    expect(resolveSearchRoute("")).toBeNull();
    expect(resolveSearchRoute("   ")).toBeNull();
  });
});

describe("resolveSearchRoute for assets", () => {
  it("routes native and XLM to the XLM asset contract on the configured network", () => {
    const xlm = Asset.native().contractId(TESTNET);
    expect(xlm).toMatch(/^C[A-Z2-7]{55}$/);
    expect(resolveSearchRoute("native", TESTNET)).toBe(`/contract/${xlm}`);
    expect(resolveSearchRoute("XLM", TESTNET)).toBe(`/contract/${xlm}`);
  });

  it("routes CODE:ISSUER to that asset's contract", () => {
    const usdc = new Asset("USDC", ISSUER).contractId(TESTNET);
    expect(resolveSearchRoute(`USDC:${ISSUER}`, TESTNET)).toBe(
      `/contract/${usdc}`
    );
  });

  it("gives a different contract for the same asset on another network", () => {
    expect(resolveSearchRoute("native", TESTNET)).not.toBe(
      resolveSearchRoute("native", MAINNET)
    );
  });

  it("sends asset queries to /search when no passphrase is given", () => {
    const query = `USDC:${ISSUER}`;
    expect(resolveSearchRoute("native")).toBe("/search?q=native");
    expect(resolveSearchRoute(query)).toBe(
      `/search?q=${encodeURIComponent(query)}`
    );
  });

  it("falls through to /search for an invalid code or issuer", () => {
    const badQueries = [
      "USDC:GBAD",
      `TOO-LONG-CODE:${ISSUER}`,
      `USDC:${ISSUER.slice(0, -1)}`,
      `:${ISSUER}`,
      "USDC:",
      "a:b:c",
    ];
    for (const bad of badQueries) {
      expect(resolveSearchRoute(bad, TESTNET)).toBe(
        `/search?q=${encodeURIComponent(bad)}`
      );
    }
  });
});
