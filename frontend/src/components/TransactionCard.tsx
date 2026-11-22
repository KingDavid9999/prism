import Link from "next/link";
import type { TransactionRecord } from "@/types";
import { shortHash, formatFee } from "@/lib/format";
import RelativeTime from "@/components/RelativeTime";
import { decodeInvocation } from "@/lib/xdr/invocation";
import { xdr } from "@stellar/stellar-sdk";

interface Props {
  tx: TransactionRecord;
}

export default function TransactionCard({ tx }: Props) {
  let invocation = null;
  try {
    const envelope = xdr.TransactionEnvelope.fromXDR(tx.envelopeXdr, "base64");
    invocation = decodeInvocation(envelope);
  } catch {
    // Ignore decode errors
  }

  return (
    <Link
      href={`/tx/${tx.hash}`}
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 rounded-lg border border-prism-border bg-prism-surface hover:border-prism-accent transition gap-3 sm:gap-4"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs font-semibold px-2 py-1 rounded whitespace-nowrap ${tx.successful ? "bg-prism-green/20 text-prism-green" : "bg-prism-red/20 text-prism-red"}`}
          >
            {tx.successful ? "SUCCESS" : "FAILED"}
          </span>
          {invocation && (
            <span className="text-xs font-semibold px-2 py-1 rounded bg-prism-blue/20 text-prism-blue whitespace-nowrap">
              {invocation.functionName}
            </span>
          )}
        </div>
        <span className="font-mono text-sm text-prism-strong truncate">
          {shortHash(tx.hash)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-sm text-prism-muted">
        <span className="whitespace-nowrap">
          {tx.operationCount} op{tx.operationCount !== 1 ? "s" : ""}
        </span>
        <span className="whitespace-nowrap">{formatFee(tx.fee)}</span>
        <span className="truncate max-w-[200px] sm:max-w-none">
          <RelativeTime iso={tx.createdAt} />
        </span>
      </div>
    </Link>
  );
}
