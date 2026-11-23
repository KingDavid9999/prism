/**
 * Slow-down rules for the live polling lists.
 *
 * After a throttled or failed request the poller waits for the server's
 * `Retry-After` when it sends one, and otherwise doubles the interval for each
 * consecutive failure, up to a cap. A successful poll resets the count.
 */

/** Longest wait between polls after repeated failures without a Retry-After. */
export const MAX_POLL_BACKOFF_MS = 5 * 60_000;

/**
 * Milliseconds to wait according to a response's `Retry-After` header, which
 * may be a number of seconds or an HTTP date. Returns null when the header is
 * missing or cannot be read.
 */
export function retryAfterMs(res: Response, now = Date.now()): number | null {
  const value = res.headers.get("Retry-After")?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export interface PollBackoff {
  /** Call after a poll succeeds. */
  succeeded(): void;
  /**
   * Call after a poll fails, passing the response when one arrived. Returns
   * how long to pause before the next poll.
   */
  failed(res?: Response | null): number;
}

export function createPollBackoff(intervalMs: number): PollBackoff {
  let failures = 0;
  return {
    succeeded() {
      failures = 0;
    },
    failed(res) {
      failures += 1;
      const fromHeader = res ? retryAfterMs(res) : null;
      if (fromHeader !== null) return fromHeader;
      return Math.min(intervalMs * 2 ** failures, MAX_POLL_BACKOFF_MS);
    },
  };
}

export type PollResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** HTTP status, or null when no response arrived (network error). */
      status: number | null;
      /** The parsed JSON body when there was one. */
      body: { error?: string } | null;
      /** How long the poller should wait before its next request. */
      pauseMs: number;
    };

/**
 * GET a JSON endpoint for a live list. A failure reports the pause the poller
 * should take next, honoring the response's Retry-After when it has one.
 */
export async function pollJson<T>(
  url: string,
  backoff: PollBackoff
): Promise<PollResult<T>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { ok: false, status: null, body: null, pauseMs: backoff.failed() };
  }
  // Read the status before the body so a non-JSON 429 still honors Retry-After.
  const body = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!res.ok || body === null) {
    return {
      ok: false,
      status: res.status,
      body,
      pauseMs: backoff.failed(res),
    };
  }
  backoff.succeeded();
  return { ok: true, data: body as T };
}
