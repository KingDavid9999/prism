import { Address, xdr } from "@stellar/stellar-sdk";
import type {
  AuthorizationCredentials,
  AuthorizationEntry,
  AuthorizedInvocationNode,
  ContractDeployment,
  FootprintEntry,
  OperationAuthorizations,
  OperationInvocation,
  ResourceUsage,
  SorobanInvocation,
} from "@/types";
import { scValToDisplay } from "./display";

/**
 * The v1 transaction body, unwrapping a fee bump to reach the inner one.
 *
 * Returns null for v0 envelopes: they predate Soroban and have a different
 * shape (a bare ed25519 key rather than a muxed account, and no Soroban
 * resource data), so callers looking for contract activity have nothing to
 * find in one.
 */
export function v1Tx(
  envelope: xdr.TransactionEnvelope
): xdr.Transaction | null {
  const kind = envelope.switch().name;
  if (kind === "envelopeTypeTxFeeBump")
    return envelope.feeBump().tx().innerTx().v1().tx();
  if (kind === "envelopeTypeTx") return envelope.v1().tx();
  return null;
}

/**
 * Decode every InvokeHostFunction contract call in a transaction envelope, in
 * operation order. A transaction can call several contracts, so each call is
 * tagged with the index of the operation it came from.
 */
export function decodeInvocations(
  envelope: xdr.TransactionEnvelope
): OperationInvocation[] {
  try {
    const tx = v1Tx(envelope);
    if (!tx) return [];
    const invocations: OperationInvocation[] = [];
    tx.operations().forEach((op, operationIndex) => {
      if (op.body().switch().name !== "invokeHostFunction") return;
      const hostFn = op.body().invokeHostFunctionOp().hostFunction();
      if (hostFn.switch().name !== "hostFunctionTypeInvokeContract") return;
      const invoke = hostFn.invokeContract();
      invocations.push({
        operationIndex,
        contractId: Address.fromScAddress(invoke.contractAddress()).toString(),
        functionName: invoke.functionName().toString(),
        args: invoke.args().map(scValToDisplay),
      });
    });
    return invocations;
  } catch {
    return [];
  }
}

/** Decode a transaction envelope's first InvokeHostFunction contract call (function name + args), if any. */
export function decodeInvocation(
  envelope: xdr.TransactionEnvelope
): SorobanInvocation | null {
  return decodeInvocations(envelope)[0] ?? null;
}

/** One line saying who signed an authorization entry. */
export function describeCredentials(
  credentials: AuthorizationCredentials
): string {
  switch (credentials.kind) {
    case "sourceAccount":
      return "transaction source account";
    case "address":
      return `${credentials.address} (nonce ${credentials.nonce}, expires at ledger ${credentials.expirationLedger})`;
    case "other":
      return credentials.type;
  }
}

function describeAuthorizedFunction(fn: xdr.SorobanAuthorizedFunction): string {
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    return "create contract";
  }
  const call = fn.contractFn();
  const contract = Address.fromScAddress(call.contractAddress()).toString();
  const args = call.args().map(scValToDisplay).join(", ");
  return `${contract}.${call.functionName().toString()}(${args})`;
}

function authorizedInvocationNode(
  invocation: xdr.SorobanAuthorizedInvocation
): AuthorizedInvocationNode {
  return {
    label: describeAuthorizedFunction(invocation.function()),
    subInvocations: invocation.subInvocations().map(authorizedInvocationNode),
  };
}

/**
 * Decode one SorobanAuthorizationEntry: the credentials that authorized it and
 * the call tree it covers. The tree's sub-invocations are the contract-to-
 * contract calls made under that authorization.
 */
export function decodeAuthorizationEntry(
  entry: xdr.SorobanAuthorizationEntry
): AuthorizationEntry {
  const credentials = entry.credentials();
  const kind = credentials.switch().name;
  let description: AuthorizationCredentials;
  if (kind === "sorobanCredentialsSourceAccount") {
    description = { kind: "sourceAccount" };
  } else if (kind === "sorobanCredentialsAddress") {
    const address = credentials.address();
    description = {
      kind: "address",
      address: Address.fromScAddress(address.address()).toString(),
      nonce: address.nonce().toString(),
      expirationLedger: address.signatureExpirationLedger(),
    };
  } else {
    description = { kind: "other", type: kind };
  }
  return {
    credentials: description,
    root: authorizedInvocationNode(entry.rootInvocation()),
  };
}

function wasmHashOf(executable: xdr.ContractExecutable): string | null {
  return executable.switch().name === "contractExecutableWasm"
    ? bytesToHex(executable.wasmHash())
    : null;
}

/**
 * Decode each contract creation (CreateContract, CreateContractV2) and WASM
 * upload in a transaction, in operation order. An upload carries its code, so
 * its hash is computed here with SHA-256, the hash the ledger stores it under.
 */
export async function decodeDeployments(
  envelope: xdr.TransactionEnvelope
): Promise<ContractDeployment[]> {
  try {
    const tx = v1Tx(envelope);
    if (!tx) return [];
    const deployments: ContractDeployment[] = [];
    const operations = tx.operations();
    for (
      let operationIndex = 0;
      operationIndex < operations.length;
      operationIndex++
    ) {
      const op = operations[operationIndex];
      if (op.body().switch().name !== "invokeHostFunction") continue;
      const hostFn = op.body().invokeHostFunctionOp().hostFunction();
      const kind = hostFn.switch().name;
      if (kind === "hostFunctionTypeCreateContractV2") {
        const args = hostFn.createContractV2();
        deployments.push({
          operationIndex,
          kind: "createContractV2",
          wasmHash: wasmHashOf(args.executable()),
          constructorArgs: args.constructorArgs().map(scValToDisplay),
        });
      } else if (kind === "hostFunctionTypeCreateContract") {
        deployments.push({
          operationIndex,
          kind: "createContract",
          wasmHash: wasmHashOf(hostFn.createContract().executable()),
          constructorArgs: [],
        });
      } else if (kind === "hostFunctionTypeUploadContractWasm") {
        const wasm = hostFn.wasm();
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new Uint8Array(wasm)
        );
        deployments.push({
          operationIndex,
          kind: "uploadWasm",
          wasmHash: bytesToHex(new Uint8Array(digest)),
          wasmSize: wasm.length,
          constructorArgs: [],
        });
      }
    }
    return deployments;
  } catch {
    return [];
  }
}

/**
 * Decode the authorization entries each InvokeHostFunction operation carries,
 * in operation order. Operations with no entries are left out.
 */
export function decodeAuthorizations(
  envelope: xdr.TransactionEnvelope
): OperationAuthorizations[] {
  try {
    const tx = v1Tx(envelope);
    if (!tx) return [];
    const out: OperationAuthorizations[] = [];
    tx.operations().forEach((op, operationIndex) => {
      if (op.body().switch().name !== "invokeHostFunction") return;
      const entries = op.body().invokeHostFunctionOp().auth();
      if (entries.length) {
        out.push({
          operationIndex,
          entries: entries.map(decodeAuthorizationEntry),
        });
      }
    });
    return out;
  } catch {
    return [];
  }
}

function bytesToHex(bytes: Iterable<number>): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Label a ledger key for the footprint list. Contract data gets its contract
 * and storage key; WASM code gets its hash; other key kinds fall back to the
 * XDR arm name so an unfamiliar entry is still visible.
 */
function ledgerKeyLabel(key: xdr.LedgerKey): string {
  const kind = key.switch().name;
  try {
    if (kind === "contractData") {
      const data = key.contractData();
      const contract = Address.fromScAddress(data.contract()).toString();
      return `${contract} — ${scValToDisplay(data.key())}`;
    }
    if (kind === "contractCode") {
      return `code ${bytesToHex(key.contractCode().hash())}`;
    }
  } catch {
    // A malformed or newer key still gets a label rather than crashing the page.
  }
  return kind;
}

/**
 * Decode a transaction envelope's Soroban resource data: limits, the resource
 * fee, and every ledger entry in its footprint (read-only and read-write).
 *
 * `feeChargedStroops`, when supplied from Horizon's transaction record, lets
 * the caller split the total fee into its inclusion and resource parts.
 */
export function getResourceUsage(
  envelope: xdr.TransactionEnvelope,
  feeChargedStroops?: string | number
): ResourceUsage | null {
  try {
    const tx = v1Tx(envelope);
    if (!tx) return null;
    const ext = tx.ext();
    if (ext.switch() !== 1) return null;
    const data = ext.sorobanData();
    const resources = data.resources();
    const footprint = resources.footprint();
    const footprintEntries: FootprintEntry[] = [
      ...footprint.readOnly().map((key): FootprintEntry => ({
        access: "read",
        label: ledgerKeyLabel(key),
      })),
      ...footprint.readWrite().map((key): FootprintEntry => ({
        access: "write",
        label: ledgerKeyLabel(key),
      })),
    ];
    const resourceFeeStroops = data.resourceFee().toString();
    return {
      instructions: resources.instructions(),
      readBytes: resources.diskReadBytes(),
      writeBytes: resources.writeBytes(),
      resourceFeeStroops,
      footprint: footprintEntries,
      inclusionFeeStroops:
        feeChargedStroops === undefined
          ? undefined
          : (BigInt(feeChargedStroops) - BigInt(resourceFeeStroops)).toString(),
    };
  } catch {
    return null;
  }
}
