import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  decodeAuthorizations,
  decodeDeployments,
  decodeInvocation,
  decodeInvocations,
} from "./xdr";

const firstContract = StrKey.encodeContract(Buffer.alloc(32, 1));
const secondContract = StrKey.encodeContract(Buffer.alloc(32, 2));

function envelopeWith(...operations: xdr.Operation[]): xdr.TransactionEnvelope {
  const source = new Account(Keypair.random().publicKey(), "1");
  const builder = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of operations) builder.addOperation(op);
  return builder.setTimeout(30).build().toEnvelope();
}

describe("decodeInvocations", () => {
  it("decodes every contract call, tagged with its operation index", () => {
    const envelope = envelopeWith(
      new Contract(firstContract).call("transfer"),
      new Contract(secondContract).call("mint")
    );

    expect(decodeInvocations(envelope)).toEqual([
      {
        operationIndex: 0,
        contractId: firstContract,
        functionName: "transfer",
        args: [],
      },
      {
        operationIndex: 1,
        contractId: secondContract,
        functionName: "mint",
        args: [],
      },
    ]);
  });

  it("skips operations that are not contract calls, keeping their indices", () => {
    const envelope = envelopeWith(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
      new Contract(secondContract).call("mint")
    );

    expect(decodeInvocations(envelope)).toEqual([
      {
        operationIndex: 1,
        contractId: secondContract,
        functionName: "mint",
        args: [],
      },
    ]);
  });

  it("returns nothing when the transaction makes no contract call", () => {
    const envelope = envelopeWith(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      })
    );

    expect(decodeInvocations(envelope)).toEqual([]);
  });
});

describe("decodeInvocation", () => {
  it("returns the first contract call", () => {
    const envelope = envelopeWith(
      new Contract(firstContract).call("transfer"),
      new Contract(secondContract).call("mint")
    );

    expect(decodeInvocation(envelope)?.contractId).toBe(firstContract);
  });
});

/** An InvokeHostFunction operation calling `fn` on `contract`, carrying the given authorization entries. */
function invokeOperation(
  contract: string,
  fn: string,
  auth: xdr.SorobanAuthorizationEntry[]
): xdr.Operation {
  return new xdr.Operation({
    sourceAccount: null,
    body: xdr.OperationBody.invokeHostFunction(
      new xdr.InvokeHostFunctionOp({
        hostFunction: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(contract).toScAddress(),
            functionName: fn,
            args: [],
          })
        ),
        auth,
      })
    ),
  });
}

function contractCall(
  contract: string,
  fn: string,
  args: xdr.ScVal[] = [],
  subInvocations: xdr.SorobanAuthorizedInvocation[] = []
): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(contract).toScAddress(),
          functionName: fn,
          args,
        })
      ),
    subInvocations,
  });
}

describe("decodeAuthorizations", () => {
  it("renders the authorizer and both levels of a call tree with a sub-invocation", () => {
    const author = Keypair.random().publicKey();
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(author).toScAddress(),
          nonce: new xdr.Int64(5),
          signatureExpirationLedger: 1234,
          signature: xdr.ScVal.scvVoid(),
        })
      ),
      rootInvocation: contractCall(
        firstContract,
        "swap",
        [],
        [contractCall(secondContract, "transfer", [xdr.ScVal.scvU32(10)])]
      ),
    });
    const envelope = envelopeWith(
      invokeOperation(firstContract, "swap", [entry])
    );

    expect(decodeAuthorizations(envelope)).toEqual([
      {
        operationIndex: 0,
        entries: [
          {
            credentials: {
              kind: "address",
              address: author,
              nonce: "5",
              expirationLedger: 1234,
            },
            root: {
              label: `${firstContract}.swap()`,
              subInvocations: [
                {
                  label: `${secondContract}.transfer(10)`,
                  subInvocations: [],
                },
              ],
            },
          },
        ],
      },
    ]);
  });

  it("reports a source-account authorization and skips operations without entries", () => {
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: contractCall(firstContract, "mint"),
    });
    const envelope = envelopeWith(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
      invokeOperation(secondContract, "noop", []),
      invokeOperation(firstContract, "mint", [entry])
    );

    expect(decodeAuthorizations(envelope)).toEqual([
      {
        operationIndex: 2,
        entries: [
          {
            credentials: { kind: "sourceAccount" },
            root: { label: `${firstContract}.mint()`, subInvocations: [] },
          },
        ],
      },
    ]);
  });
});

describe("decodeDeployments", () => {
  const WASM_HASH = "09".repeat(32);
  const preimage = (deployer: string) =>
    xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: new Address(deployer).toScAddress(),
        salt: Buffer.alloc(32, 3),
      })
    );
  const executable = () =>
    xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 9));

  it("decodes a CreateContract, which has no constructor arguments", async () => {
    const deployer = Keypair.random().publicKey();
    const envelope = envelopeWith(
      new xdr.Operation({
        sourceAccount: null,
        body: xdr.OperationBody.invokeHostFunction(
          new xdr.InvokeHostFunctionOp({
            hostFunction: xdr.HostFunction.hostFunctionTypeCreateContract(
              new xdr.CreateContractArgs({
                contractIdPreimage: preimage(deployer),
                executable: executable(),
              })
            ),
            auth: [],
          })
        ),
      })
    );

    expect(await decodeDeployments(envelope)).toEqual([
      {
        operationIndex: 0,
        kind: "createContract",
        wasmHash: WASM_HASH,
        constructorArgs: [],
      },
    ]);
  });

  it("decodes a CreateContractV2 with its constructor arguments", async () => {
    const deployer = Keypair.random().publicKey();
    const envelope = envelopeWith(
      new xdr.Operation({
        sourceAccount: null,
        body: xdr.OperationBody.invokeHostFunction(
          new xdr.InvokeHostFunctionOp({
            hostFunction: xdr.HostFunction.hostFunctionTypeCreateContractV2(
              new xdr.CreateContractArgsV2({
                contractIdPreimage: preimage(deployer),
                executable: executable(),
                constructorArgs: [
                  xdr.ScVal.scvSymbol("admin"),
                  xdr.ScVal.scvU32(7),
                ],
              })
            ),
            auth: [],
          })
        ),
      })
    );

    expect(await decodeDeployments(envelope)).toEqual([
      {
        operationIndex: 0,
        kind: "createContractV2",
        wasmHash: WASM_HASH,
        constructorArgs: ["admin", "7"],
      },
    ]);
  });

  it("hashes an uploaded WASM and reports its size, skipping other operations", async () => {
    const code = Buffer.from("\0asm-prism-test-module");
    const envelope = envelopeWith(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
      new xdr.Operation({
        sourceAccount: null,
        body: xdr.OperationBody.invokeHostFunction(
          new xdr.InvokeHostFunctionOp({
            hostFunction:
              xdr.HostFunction.hostFunctionTypeUploadContractWasm(code),
            auth: [],
          })
        ),
      })
    );

    expect(await decodeDeployments(envelope)).toEqual([
      {
        operationIndex: 1,
        kind: "uploadWasm",
        wasmHash: createHash("sha256").update(code).digest("hex"),
        wasmSize: code.length,
        constructorArgs: [],
      },
    ]);
  });
});
