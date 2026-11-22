import Link from "next/link";
import {
  getLatestLedger,
  getLedger,
  getLedgerTransactions,
  isNotFound,
} from "@/lib/horizon";
import { formatDate, formatNumber } from "@/lib/format";
import { notFound } from "next/navigation";
import DetailRow from "@/components/DetailRow";
import TransactionCard from "@/components/TransactionCard";
import type { Metadata } from "next";
import type { TransactionRecord } from "@/types";

export const dynamic = "force-dynamic";

interface Props {
  params: { seq: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const title = `Ledger #${params.seq}`;
  try {
    const ledger = await getLedger(parseInt(params.seq, 10));
    const description = `Stellar ledger #${ledger.sequence} with ${formatNumber(ledger.operationCount)} operations and ${formatNumber(ledger.transactionCount)} transactions.`;
    return {
      title,
      description,
      openGraph: { title, description },
    };
  } catch {
    return {
      title,
      description: `Stellar ledger #${params.seq}.`,
    };
  }
}

export default async function LedgerPage({ params }: Props) {
  if (!/^\d+$/.test(params.seq)) notFound();
  const seq = parseInt(params.seq, 10);
  if (seq > 4_294_967_295) notFound();

  let ledger;
  try {
    ledger = await getLedger(seq);
  } catch (err) {
    if (isNotFound(err)) notFound();
    throw err;
  }

  // Fetch transactions for this ledger. Issue #279.
  let transactions: TransactionRecord[] = [];
  try {
    const txResult = await getLedgerTransactions(seq, 100);
    transactions = txResult.records;
  } catch {
    // Silently fail if transactions can't be fetched
  }

  // Without a latest ledger we can't tell whether this one is the newest, so
  // leave "next" out rather than link to a ledger that may not exist yet.
  const latest = await getLatestLedger().catch(() => null);
  const prevSeq = seq > 1 ? seq - 1 : null;
  const nextSeq = latest && seq < latest.sequence ? seq + 1 : null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Ledger</h1>
      <p className="text-prism-muted font-mono text-sm mb-4">
        #{ledger.sequence}
      </p>

      <nav
        aria-label="Ledger navigation"
        className="flex justify-between text-sm mb-8"
      >
        <span>
          {prevSeq !== null && (
            <Link
              href={`/ledger/${prevSeq}`}
              className="text-prism-accent hover:underline"
            >
              &larr; Ledger #{prevSeq}
            </Link>
          )}
        </span>
        <span>
          {nextSeq !== null && (
            <Link
              href={`/ledger/${nextSeq}`}
              className="text-prism-accent hover:underline"
            >
              Ledger #{nextSeq} &rarr;
            </Link>
          )}
        </span>
      </nav>

      <div className="rounded-xl border border-prism-border bg-prism-surface p-6 space-y-4">
        <DetailRow label="Hash" value={ledger.hash} mono />
        <DetailRow label="Closed At" value={formatDate(ledger.closedAt)} />
        <DetailRow
          label="Protocol Version"
          value={String(ledger.protocolVersion)}
        />
        <DetailRow
          label="Max Tx Set Size"
          value={formatNumber(ledger.maxTxSetSize)}
        />
        <DetailRow
          label="Tx Set Operation Ct"
          value={formatNumber(ledger.txSetOperationCount)}
        />
        <DetailRow
          label="Transactions"
          value={formatNumber(ledger.transactionCount)}
        />
        <DetailRow
          label="Successful Txs"
          value={formatNumber(ledger.successfulTransactionCount)}
        />
        <DetailRow
          label="Failed Txs"
          value={formatNumber(ledger.failedTransactionCount)}
        />
        <DetailRow
          label="Operations"
          value={formatNumber(ledger.operationCount)}
        />
        <DetailRow label="Base Fee" value={`${ledger.baseFee} stroops`} />
      </div>

      {transactions.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">
            Transactions ({transactions.length})
          </h2>
          <div className="space-y-3">
            {transactions.map((tx) => (
              <TransactionCard key={tx.hash} tx={tx} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
