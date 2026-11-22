import { describe, expect, it } from "vitest";
import {
  createPollBackoff,
  MAX_POLL_BACKOFF_MS,
  retryAfterMs,
} from "./poll-backoff";

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
