import { xdr } from "@stellar/stellar-sdk";
import { normalizeBase64 } from "./identify";

export interface TransactionFailure {
  /** The transaction-level code, e.g. "txFailed" or "txBadSeq". */
  resultCode: string;
  /**
   * For a fee-bump, the code of the inner transaction that failed, e.g.
   * "txFailed". Its operation results are the ones in `operations`.
   */
  innerResultCode?: string;
  /** Per-operation outcomes, in order. */
  operations: { index: number; code: string; failed: boolean }[];
}

/**
 * What Horizon's result XDR says about a transaction's outcome.
 *
 * `undecodable` is kept apart from `succeeded` so a page can tell the reader
 * that a failure exists even when its reason can't be read.
 */
export type TransactionFailureResult =
  | { status: "succeeded" }
  | { status: "failed"; failure: TransactionFailure }
  | { status: "undecodable" };

/**
 * Decode why a transaction failed from Horizon's result XDR.
 *
 * Note that a failed transaction's operations are not all failures: the
 * ledger applies them in order and rolls the lot back, so earlier operations
 * commonly report success alongside the one that actually broke — which is why
 * each operation is reported with its own verdict rather than collapsed into a
 * single message.
 */
export function decodeTransactionFailure(
  resultXdrBase64: string
): TransactionFailureResult {
  let result: xdr.TransactionResult;
  try {
    result = xdr.TransactionResult.fromXDR(
      normalizeBase64(resultXdrBase64),
      "base64"
    );
  } catch {
    return { status: "undecodable" };
  }

  const resultCode = result.result().switch().name;
  if (resultCode === "txSuccess") return { status: "succeeded" };

  let operations: TransactionFailure["operations"] = [];
  let innerResultCode: string | undefined;
  try {
    // A fee-bump wraps the real transaction, so its operation results sit one
    // level down, inside the inner result pair.
    let opResults: { results(): xdr.OperationResult[] | null } = result.result();
    if (resultCode === "txFeeBumpInnerFailed") {
      const inner = result.result().innerResultPair().result();
      innerResultCode = inner.result().switch().name;
      opResults = inner.result();
    }
    operations = (opResults.results() ?? []).map((op, index) => {
      // An opInner result nests the operation's own result union; the generic
      // value() accessor reaches it without switching on every op type.
      const code =
        op.switch().name === "opInner"
          ? (op.tr() as unknown as { value(): { switch(): { name: string } } })
              .value()
              .switch().name
          : op.switch().name;
      return { index, code, failed: !/Success$/.test(code) };
    });
  } catch {
    // Codes like txBadSeq carry no per-operation results.
  }

  return { status: "failed", failure: { resultCode, innerResultCode, operations } };
}
