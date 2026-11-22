import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { scValToDisplay } from "./index.js";

describe("scValToDisplay", () => {
  it("renders the contract instance key as __instance__", () => {
    // The indexer and the frontend must agree on this label.
    expect(scValToDisplay(xdr.ScVal.scvLedgerKeyContractInstance())).toBe(
      "__instance__"
    );
  });

  it("renders a contract instance value without dumping its js-xdr class", () => {
    const instance = new xdr.ScContractInstance({
      executable: xdr.ContractExecutable.contractExecutableWasm(
        Buffer.alloc(32)
      ),
      storage: null,
    });
    expect(scValToDisplay(xdr.ScVal.scvContractInstance(instance))).toBe(
      "(contract instance)"
    );
  });

  it("renders void, symbols and vecs", () => {
    expect(scValToDisplay(xdr.ScVal.scvVoid())).toBe("void");
    expect(scValToDisplay(xdr.ScVal.scvSymbol("Admin"))).toBe("Admin");
    expect(
      scValToDisplay(
        xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2)])
      )
    ).toBe("[1,2]");
  });
});
