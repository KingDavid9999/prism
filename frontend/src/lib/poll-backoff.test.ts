import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPollBackoff,
  MAX_POLL_BACKOFF_MS,
  pollJson,
  retryAfterMs,
} from "./poll-backoff";
import { startVisibilityPolling } from "./visibility-poll";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function responseWith(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 429, headers });
}

describe("retryAfterMs", () => {
  it("reads a delay given in seconds", () => {
    expect(retryAfterMs(responseWith({ "Retry-After": "12" }))).toBe(12_000);
  });

  it("reads an HTTP date relative to the current time", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    const res = responseWith({
      "Retry-After": "Wed, 21 Oct 2015 07:28:30 GMT",
    });
    expect(retryAfterMs(res, now)).toBe(30_000);
  });

  it("never returns a negative delay for a date in the past", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:30:00 GMT");
    const res = responseWith({
      "Retry-After": "Wed, 21 Oct 2015 07:28:30 GMT",
    });
    expect(retryAfterMs(res, now)).toBe(0);
  });

  it("returns null when the header is missing or cannot be read", () => {
    expect(retryAfterMs(responseWith())).toBeNull();
    expect(retryAfterMs(responseWith({ "Retry-After": "soon" }))).toBeNull();
  });
});

describe("createPollBackoff", () => {
  it("doubles the wait for each consecutive failure", () => {
    const backoff = createPollBackoff(15_000);
    expect(backoff.failed()).toBe(30_000);
    expect(backoff.failed()).toBe(60_000);
    expect(backoff.failed()).toBe(120_000);
  });

  it("stops growing the wait at the cap", () => {
    const backoff = createPollBackoff(15_000);
    for (let i = 0; i < 20; i++) backoff.failed();
    expect(backoff.failed()).toBe(MAX_POLL_BACKOFF_MS);
  });

  it("uses Retry-After when the failed response carries it", () => {
    const backoff = createPollBackoff(15_000);
    expect(backoff.failed(responseWith({ "Retry-After": "45" }))).toBe(45_000);
  });

  it("falls back to doubling when the response has no Retry-After", () => {
    const backoff = createPollBackoff(15_000);
    expect(backoff.failed(responseWith())).toBe(30_000);
  });

  it("starts over after a successful poll", () => {
    const backoff = createPollBackoff(15_000);
    backoff.failed();
    backoff.failed();
    backoff.succeeded();
    expect(backoff.failed()).toBe(30_000);
  });
});

describe("pollJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed body and resets the backoff on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ events: [1] })));
    const backoff = createPollBackoff(15_000);
    backoff.failed();

    const result = await pollJson<{ events: number[] }>("/api/x", backoff);
    expect(result).toEqual({ ok: true, data: { events: [1] } });
    expect(backoff.failed()).toBe(30_000);
  });

  it("reports the Retry-After pause for a 429 and the error from its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "Rate limit exceeded. Try again shortly." },
          { status: 429, headers: { "Retry-After": "20" } }
        )
      )
    );

    const result = await pollJson("/api/x", createPollBackoff(15_000));
    expect(result).toEqual({
      ok: false,
      status: 429,
      body: { error: "Rate limit exceeded. Try again shortly." },
      pauseMs: 20_000,
    });
  });

  it("treats a non-JSON error body as a failure rather than data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Too many</html>", { status: 503 }))
    );

    const result = await pollJson("/api/x", createPollBackoff(15_000));
    expect(result).toMatchObject({ ok: false, status: 503, pauseMs: 30_000 });
  });

  it("reports a network failure with no status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const result = await pollJson("/api/x", createPollBackoff(15_000));
    expect(result).toMatchObject({ ok: false, status: null, pauseMs: 30_000 });
  });
});

describe("a throttled poll on the visibility timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("delays the next request by Retry-After after a 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Rate limit exceeded. Try again shortly." },
          { status: 429, headers: { "Retry-After": "30" } }
        )
      )
      .mockResolvedValue(jsonResponse({ invocations: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const backoff = createPollBackoff(15_000);
    const stop = startVisibilityPolling({
      intervalMs: 15_000,
      refresh: async () => {
        const result = await pollJson("/api/x", backoff);
        return result.ok ? undefined : result.pauseMs;
      },
      isHidden: () => false,
      addVisibilityListener: () => {},
      removeVisibilityListener: () => {},
    });

    await vi.advanceTimersByTimeAsync(15_000); // first poll: 429
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The pause runs from t = 15 s for 30 s, so the tick at t = 30 s does nothing.
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1); // t = 45 s: pause over
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });
});
