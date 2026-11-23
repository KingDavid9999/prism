"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import InvocationHistory from "./InvocationHistory";
import SectionHeader from "./SectionHeader";
import { appendUnique, mergeVisible } from "@/lib/list-pagination";
import { startVisibilityPolling } from "@/lib/visibility-poll";
import { createPollBackoff, pollJson } from "@/lib/poll-backoff";
import type { InvocationHistoryItem } from "@/types";

interface Props {
  contractId: string;
  initialItems: InvocationHistoryItem[];
  initialNextCursor: string | null;
  /** Page size the list is fetched with, used to tell when the RPC fallback is capped. */
  limit: number;
  /** True when no indexer is configured, so the items come from recent RPC events. */
  derivedFromEvents: boolean;
  title: string;
  /** Rendered after the count in the section header. */
  children?: ReactNode;
  intervalMs?: number;
}

export default function LiveInvocationHistory({
  contractId,
  initialItems,
  initialNextCursor,
  limit,
  derivedFromEvents,
  title,
  children,
  intervalMs = 15_000,
}: Props) {
  // The poll only replaces the newest page. Older pages fetched with "Load
  // older" live in their own state so refreshing the first page can't discard
  // them, and a page that shifts into the first page is de-duplicated by hash.
  const [firstPage, setFirstPage] = useState(initialItems);
  const [olderItems, setOlderItems] = useState<InvocationHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  const items = mergeVisible(firstPage, olderItems, (item) => item.txHash);

  useEffect(() => {
    const backoff = createPollBackoff(intervalMs);
    return startVisibilityPolling({
      intervalMs,
      refresh: async () => {
        const result = await pollJson<{
          invocations: InvocationHistoryItem[];
          nextCursor?: string | null;
        }>(`/api/contract/${contractId}/invocations`, backoff);
        // On failure keep showing the last good data and wait out the pause.
        if (!result.ok) return result.pauseMs;
        setFirstPage(result.data.invocations);
        setNextCursor(result.data.nextCursor ?? null);
      },
    });
  }, [contractId, intervalMs]);

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const res = await fetch(
        `/api/contract/${contractId}/invocations?cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!res.ok) throw new Error("The invocations API could not be reached.");
      const data = await res.json();
      setOlderItems((prev) =>
        appendUnique(
          prev,
          data.invocations as InvocationHistoryItem[],
          (item) => item.txHash
        )
      );
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      setOlderError(
        err instanceof Error ? err.message : "Could not load older invocations."
      );
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <>
      <SectionHeader
        title={title}
        count={items.length}
        cap={nextCursor !== null || derivedFromEvents ? limit : undefined}
        live
      />
      {children}
      <InvocationHistory items={items} derivedFromEvents={derivedFromEvents} />
      {nextCursor && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingOlder}
            className="border border-prism-border px-4 py-2 rounded-lg text-xs font-medium text-prism-muted hover:text-prism-strong transition disabled:opacity-50"
          >
            {loadingOlder ? "Loading older…" : "Load older"}
          </button>
          {olderError && (
            <span className="text-xs text-prism-red">{olderError}</span>
          )}
        </div>
      )}
    </>
  );
}
