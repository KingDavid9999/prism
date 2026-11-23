import Link from "next/link";
import type { Metadata } from "next";
import { StrKey, xdr } from "@stellar/stellar-sdk";
import {
  getTransaction,
  getTransactionOperations,
  isNotFound,
  normalizeTransactionHash,
} from "@/lib/horizon";
import CopyButton from "@/components/CopyButton";
import {
  getContractWasmInfo,
  getInvocationReturnValue,
  getTransactionEvents,
  getTransactionHostError,
} from "@/lib/soroban";
import { describeContractError } from "@/lib/contract-error";
import EventLog from "@/components/EventLog";
import {
  decodeAuthorizations,
  decodeDeployments,
  decodeInvocations,
  decodeTransactionFailure,
  describeCredentials,
  getResourceUsage,
} from "@/lib/xdr";
import type { AuthorizationEntry, AuthorizedInvocationNode } from "@/types";
import {
  formatDate,
  formatFee,
  formatMemoDetail,
  stroopsToXlm,
  formatNumber,
} from "@/lib/format";
import { notFound } from "next/navigation";
import DetailRow from "@/components/DetailRow";

export const dynamic = "force-dynamic";

interface Props {
  params: { hash: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const hash = normalizeTransactionHash(params.hash);
  const displayHash = hash ?? params.hash;
  const shortHash = `${displayHash.slice(0, 8)}…${displayHash.slice(-8)}`;
  if (!hash) {
    return {
      title: `Transaction ${shortHash}`,
      description: `Stellar transaction ${displayHash}.`,
    };
  }
  try {
    const tx = await getTransaction(hash);
    const status = tx.successful ? "Success" : "Failed";
    const title = `Transaction ${shortHash} — ${status}`;
    const description = `Stellar transaction ${displayHash}: ${status}, ledger ${tx.ledger}, ${tx.operationCount} operation${tx.operationCount === 1 ? "" : "s"}, fee ${stroopsToXlm(tx.fee)}.`;
    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { title, description },
    };
  } catch {
    const title = `Transaction ${shortHash}`;
    const description = `Stellar transaction ${displayHash}.`;
    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { title, description },
    };
  }
}

export default async function TxPage({ params }: Props) {
  const hash = normalizeTransactionHash(params.hash);
  if (!hash) notFound();

  let tx;
  try {
    tx = await getTransaction(hash);
  } catch (err) {
    if (isNotFound(err)) notFound();
    throw err;
  }

  // Everything above came from Horizon's JSON and is already good. If the
  // envelope itself won't parse — a protocol upgrade introducing an operation
  // this SDK doesn't know, say — that's no reason to throw away the status,
  // fee and timestamp we can already show.
  let envelope: xdr.TransactionEnvelope | null = null;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(tx.envelopeXdr, "base64");
  } catch {
    envelope = null;
  }

  // Null for a successful transaction, so this also double-checks Horizon's
  // own `successful` flag against what the result XDR actually says.
  const outcome = tx.successful ? null : decodeTransactionFailure(tx.resultXdr);
  const failure = outcome?.status === "failed" ? outcome.failure : null;
  const failureUndecodable = outcome?.status === "undecodable";

  const invocations = envelope ? decodeInvocations(envelope) : [];
  const deployments = envelope ? await decodeDeployments(envelope) : [];
  const authorizations = envelope ? decodeAuthorizations(envelope) : [];
  const authorizationsFor = (operationIndex: number) =>
    authorizations.find((a) => a.operationIndex === operationIndex)?.entries ??
    [];
  const resources = envelope ? getResourceUsage(envelope, tx.fee) : null;
  // A Soroban transaction has one operation, so its return value belongs to
  // the invocation or the contract it creates.
  const returnValue =
    invocations.length > 0 || deployments.length > 0
      ? await getInvocationReturnValue(tx.hash)
      : null;

  // RPC's diagnostic events name the host error that trapped a failed Soroban
  // call, and its events are the ones the transaction emitted. Naming a
  // contract error and labelling event fields both need that contract's spec.
  const hostError =
    !tx.successful && invocations.length > 0
      ? await getTransactionHostError(tx.hash)
      : null;
  const events =
    invocations.length > 0 ? await getTransactionEvents(tx.hash) : [];
  // Only fetch specs when something needs them: fetching WASM is not free.
  const specContractIds = [
    ...new Set([
      ...(hostError ? invocations.slice(0, 1).map((i) => i.contractId) : []),
      ...events.map((e) => e.contractId),
    ]),
  ];
  const specs = new Map(
    await Promise.all(
      specContractIds.map(
        async (id) => [id, await getContractWasmInfo(id)] as const
      )
    )
  );
  const namedError =
    hostError && invocations.length > 0
      ? describeContractError(
          hostError,
          specs.get(invocations[0].contractId)?.types ?? []
        )
      : null;
  const eventSpecs = specContractIds.flatMap(
    (id) => specs.get(id)?.events ?? []
  );

  // Non-Soroban transactions have no invocation panel, so their operations
  // would otherwise be visible only as a count. The operations resource is
  // independent of the envelope; a failure there shouldn't hide the rest.
  const operations =
    tx.operationCount > 0
      ? await getTransactionOperations(hash).catch(() => [])
      : [];
  const memo = tx.memo ? formatMemoDetail(tx.memo, tx.memoType) : null;

  // Resource usage describes the whole transaction, so it is rendered once —
  // under the first invocation when there is one, or on its own otherwise.
  const resourceRows = resources ? (
    <>
      <DetailRow
        label="CPU Instructions"
        value={formatNumber(resources.instructions)}
      />
      <DetailRow label="Read Bytes" value={formatNumber(resources.readBytes)} />
      <DetailRow
        label="Write Bytes"
        value={formatNumber(resources.writeBytes)}
      />
      {resources.inclusionFeeStroops !== undefined && (
        <DetailRow
          label="Inclusion Fee"
          value={`${Number(resources.inclusionFeeStroops).toLocaleString()} stroops`}
        />
      )}
      <DetailRow
        label="Resource Fee"
        value={`${Number(resources.resourceFeeStroops).toLocaleString()} stroops`}
      />
      {resources.footprint.length > 0 && (
        <div className="border-t border-prism-border pt-3">
          <p className="text-prism-muted text-sm mb-2">Footprint</p>
          <ul className="space-y-1">
            {resources.footprint.map((entry, j) => (
              <li
                key={`${entry.access}-${j}`}
                className="flex gap-2 text-xs font-mono break-all"
              >
                <span
                  className={`shrink-0 ${entry.access === "write" ? "text-prism-accent" : "text-prism-muted"}`}
                >
                  {entry.access === "write" ? "W" : "R"}
                </span>
                <span>{entry.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  ) : null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Transaction</h1>
      <div className="flex items-start gap-2 mb-8">
        <p className="text-prism-muted font-mono text-sm break-all">{hash}</p>
        <CopyButton value={hash} what="transaction hash" />
      </div>

      <div className="rounded-xl border border-prism-border bg-prism-surface p-6 space-y-4">
        <DetailRow
          label="Status"
          value={tx.successful ? "✓ Success" : "✗ Failed"}
        />
        <DetailRow label="Ledger" value={String(tx.ledger)} />
        <DetailRow label="Timestamp" value={formatDate(tx.createdAt)} />
        <DetailRow label="Source" value={tx.sourceAccount} mono />
        {tx.feeAccount && (
          <DetailRow
            label="Fee Source"
            value={tx.feeAccount}
            mono
            link={`/account/${tx.feeAccount}`}
          />
        )}
        <DetailRow
          label="Fee"
          value={`${formatFee(tx.fee)} (${stroopsToXlm(tx.fee)})`}
        />
        {tx.innerTransaction && (
          <>
            {tx.innerTransaction.feeCharged !== undefined && (
              <>
                <DetailRow
                  label="Inner Fee"
                  value={`${formatFee(tx.innerTransaction.feeCharged)} (${stroopsToXlm(tx.innerTransaction.feeCharged)})`}
                />
                <DetailRow
                  label="Outer Fee"
                  value={`${formatFee(tx.fee - tx.innerTransaction.feeCharged)} (${stroopsToXlm(tx.fee - tx.innerTransaction.feeCharged)})`}
                />
              </>
            )}
            <DetailRow
              label="Inner Hash"
              value={tx.innerTransaction.hash}
              mono
              link={`/tx/${tx.innerTransaction.hash}`}
            />
          </>
        )}
        {tx.feeBumpTransaction && tx.feeBumpTransaction.hash !== tx.hash && (
          <DetailRow
            label="Fee Bump Hash"
            value={tx.feeBumpTransaction.hash}
            mono
          />
        )}
        <DetailRow label="Operations" value={String(tx.operationCount)} />
        {memo && (
          <DetailRow label={memo.label} value={memo.value} mono={memo.mono} />
        )}
      </div>

      {operations.length > 0 && (
        <div className="mt-6 rounded-xl border border-prism-border bg-prism-surface p-6">
          <h2 className="text-lg font-semibold mb-4">Operations</h2>
          <ol className="space-y-4">
            {operations.map((op, index) => (
              <li
                key={op.id}
                className="border-b border-prism-border pb-4 last:border-0 last:pb-0"
              >
                <p className="text-sm font-semibold mb-2">
                  #{index + 1}{" "}
                  <span className="font-mono text-prism-accent">{op.type}</span>
                  {op.raw && (
                    <span className="ml-2 text-xs font-normal text-prism-muted">
                      (unrecognised type — raw fields)
                    </span>
                  )}
                </p>
                {op.sourceAccount && (
                  <DetailRow label="Source" value={op.sourceAccount} mono />
                )}
                {op.fields.map((field) => (
                  <DetailRow
                    key={field.label}
                    label={field.label}
                    value={field.value}
                    mono={field.mono}
                  />
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}

      {failure && (
        <div className="mt-6 rounded-xl border border-prism-red/30 bg-prism-red/10 p-5">
          <h2 className="text-sm font-semibold text-prism-red mb-1">
            Failed: <span className="font-mono">{failure.resultCode}</span>
            {failure.innerResultCode && (
              <>
                {" → "}
                <span className="font-mono">{failure.innerResultCode}</span>
              </>
            )}
          </h2>
          {failure.operations.length === 0 ? (
            <p className="text-xs text-prism-red/80">
              This code applies to the transaction as a whole — it carries no
              per-operation results.
            </p>
          ) : (
            <>
              <p className="text-xs text-prism-red/80 mb-3">
                The ledger applies operations in order and then rolls the whole
                transaction back, so operations marked ok ran but were
                discarded.
              </p>
              <ol className="space-y-1">
                {failure.operations.map((op) => (
                  <li key={op.index} className="flex gap-2 text-xs font-mono">
                    <span className="text-prism-muted w-8 shrink-0">
                      #{op.index}
                    </span>
                    <span
                      className={
                        op.failed
                          ? "text-prism-red font-bold"
                          : "text-prism-muted"
                      }
                    >
                      {op.code}
                    </span>
                    {op.failed && (
                      <span className="text-prism-red">&larr; failed here</span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      {hostError && (
        <div className="mt-6 rounded-xl border border-prism-red/30 bg-prism-red/10 p-5">
          <h2 className="text-sm font-semibold text-prism-red mb-1">
            Host error:{" "}
            <span className="font-mono">
              {namedError
                ? `${namedError.name} (#${namedError.code})`
                : hostError}
            </span>
          </h2>
          {namedError && (
            <p className="text-xs font-mono text-prism-red/80">{hostError}</p>
          )}
        </div>
      )}

      {failureUndecodable && (
        <div className="mt-6 rounded-xl border border-prism-red/30 bg-prism-red/10 p-4">
          <p className="text-xs text-prism-red">
            Prism couldn&apos;t decode the failure reason for this transaction.
            The raw result can still be inspected in the XDR decoder.
          </p>
          <Link
            href={`/xdr?input=${encodeURIComponent(tx.resultXdr)}`}
            className="text-xs text-prism-accent hover:underline mt-2 inline-block"
          >
            Inspect the raw result in the XDR decoder &rarr;
          </Link>
        </div>
      )}

      {!envelope && (
        <div className="mt-6 rounded-xl border border-prism-red/30 bg-prism-red/10 p-4">
          <p className="text-xs text-prism-red">
            Prism couldn&apos;t decode this transaction&apos;s envelope, so any
            contract call it contains isn&apos;t shown above. The details that
            come straight from Horizon are unaffected. This usually means the
            transaction uses something newer than the XDR definitions Prism was
            built against.
          </p>
          <Link
            href={`/xdr?input=${encodeURIComponent(tx.envelopeXdr)}`}
            className="text-xs text-prism-accent hover:underline mt-2 inline-block"
          >
            Inspect the raw envelope in the XDR decoder &rarr;
          </Link>
        </div>
      )}

      {invocations.map((invocation, i) => (
        <div
          key={invocation.operationIndex}
          className="mt-6 rounded-xl border border-prism-border bg-prism-surface p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold mb-1">
            Soroban Invocation{" "}
            <span className="text-sm font-mono text-prism-muted">
              operation #{invocation.operationIndex}
            </span>
          </h2>
          <DetailRow
            label="Contract"
            value={invocation.contractId}
            mono
            link={`/contract/${invocation.contractId}`}
          />
          <DetailRow label="Function" value={invocation.functionName} mono />
          {invocation.args.length > 0 && (
            <div className="border-b border-prism-border pb-3">
              <p className="text-prism-muted text-sm mb-2">Arguments</p>
              <div className="space-y-1">
                {invocation.args.map((a, i) => (
                  <p
                    key={i}
                    className="text-xs font-mono text-prism-muted break-all"
                  >
                    {a}
                  </p>
                ))}
              </div>
            </div>
          )}
          {authorizationsFor(invocation.operationIndex).length > 0 && (
            <AuthorizationTree
              entries={authorizationsFor(invocation.operationIndex)}
            />
          )}
          {/* Return value and resource usage describe the whole transaction, so they appear once, under the first call. */}
          {i === 0 && returnValue !== null && (
            <DetailRow label="Return Value" value={returnValue} mono />
          )}
          {i === 0 && resourceRows}
        </div>
      ))}

      {events.length > 0 && (
        <div className="mt-6 rounded-xl border border-prism-border bg-prism-surface p-6">
          <h2 className="text-lg font-semibold mb-4">Events</h2>
          <EventLog events={events} specs={eventSpecs} showMeta={false} />
        </div>
      )}

      {resources && invocations.length === 0 && (
        <div className="mt-6 rounded-xl border border-prism-border bg-prism-surface p-6 space-y-4">
          <h2 className="text-lg font-semibold">Soroban Resources</h2>
          {resourceRows}
        </div>
      )}
    </div>
  );
}

/** Who authorized a call, and the call tree each authorization covers. */
function AuthorizationTree({ entries }: { entries: AuthorizationEntry[] }) {
  return (
    <div className="border-b border-prism-border pb-3">
      <p className="text-prism-muted text-sm mb-2">Authorization</p>
      <ul className="space-y-3">
        {entries.map((entry, i) => (
          <li key={i} className="text-xs">
            <p className="text-prism-muted break-all">
              Authorized by{" "}
              <span className="font-mono">
                {describeCredentials(entry.credentials)}
              </span>
            </p>
            <ul className="mt-1 space-y-1">
              <AuthorizedCall node={entry.root} />
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One call in an authorization tree, with the contract-to-contract calls it made nested under it. */
function AuthorizedCall({ node }: { node: AuthorizedInvocationNode }) {
  return (
    <li className="font-mono break-all">
      {node.label}
      {node.subInvocations.length > 0 && (
        <ul className="mt-1 ml-4 space-y-1 list-disc">
          {node.subInvocations.map((child, i) => (
            <AuthorizedCall key={i} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
