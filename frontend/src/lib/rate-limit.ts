import { NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 30;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory, per-process fixed-window limiter. Good enough to stop a single
 * client from hammering the public Horizon/Soroban RPC nodes through this
 * API — NOT distributed, so it resets per instance on a multi-instance
 * deployment. Set RATE_LIMIT_REDIS_URL to switch to the Redis-backed store
 * which enforces a single shared limit across all instances (#28).
 */
const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60_000).unref?.();

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Seconds until the window resets. Only set when success is false. */
  retryAfter?: number;
}

/**
 * Pluggable store interface for the rate limiter (#28).
 * The in-memory default is synchronous; a Redis implementation is async.
 */
export interface RateLimitStore {
  increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; ttlMs: number }>;
}

/** Longest a Redis connect or command may take before the request gives up on it. */
const REDIS_TIMEOUT_MS = 500;
/** After a failed connect, skip Redis this long so requests don't each wait out the timeout. */
const REDIS_RETRY_AFTER_MS = 10_000;

/** Rejects if `work` hasn't settled within `ms`, so a stalled Redis can't hold a request open. */
function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  what: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms} ms`)),
      ms
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Redis-backed store. Two instances sharing the same Redis enforce one
 * combined limit. Selected automatically when RATE_LIMIT_REDIS_URL is set.
 *
 * Connects and commands are time-limited. When Redis can't be reached, the
 * store rejects, and rateLimitAsync answers from the in-memory limiter.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private client: import("ioredis").Redis | null = null;
  private connecting: Promise<import("ioredis").Redis> | null = null;
  private unavailableUntil = 0;

  constructor(private readonly url: string) {}

  private getClient(): Promise<import("ioredis").Redis> {
    if (this.client) return Promise.resolve(this.client);
    if (Date.now() < this.unavailableUntil) {
      return Promise.reject(
        new Error("Redis is unavailable after a recent failed connect")
      );
    }
    this.connecting ??= this.connect().then(
      (client) => {
        this.client = client;
        this.connecting = null;
        return client;
      },
      (err: unknown) => {
        this.connecting = null;
        this.unavailableUntil = Date.now() + REDIS_RETRY_AFTER_MS;
        throw err;
      }
    );
    return this.connecting;
  }

  private async connect(): Promise<import("ioredis").Redis> {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(this.url, {
      lazyConnect: true,
      connectTimeout: REDIS_TIMEOUT_MS,
      commandTimeout: REDIS_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      // Fail a command at once while disconnected rather than queueing it.
      enableOfflineQueue: false,
    });
    try {
      await withTimeout(client.connect(), REDIS_TIMEOUT_MS, "Redis connect");
    } catch (err) {
      client.disconnect();
      throw err;
    }
    return client;
  }

  async increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; ttlMs: number }> {
    const redis = await this.getClient();
    const windowSec = Math.ceil(windowMs / 1000);
    // Atomic INCR + EXPIRE: the Lua script ensures the TTL is set exactly once.
    const result = (await withTimeout(
      redis.eval(
        `local c = redis.call('INCR', KEYS[1])
       if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return {c, redis.call('PTTL', KEYS[1])}`,
        1,
        key,
        String(windowSec)
      ),
      REDIS_TIMEOUT_MS,
      "Redis eval"
    )) as [number, number];
    return { count: result[0], ttlMs: Math.max(0, result[1]) };
  }
}

/** The active store — Redis when RATE_LIMIT_REDIS_URL is set, otherwise in-memory. */
export const rateLimitStore: RateLimitStore | null = process.env
  .RATE_LIMIT_REDIS_URL
  ? new RedisRateLimitStore(process.env.RATE_LIMIT_REDIS_URL)
  : null;

/**
 * Core bucket logic — keyed by an arbitrary string that callers compose.
 * Returns a structured result rather than a NextResponse so it can be used
 * in non-HTTP contexts (tests, background workers, etc.).
 *
 * Uses the in-memory store directly (synchronous). For the distributed Redis
 * path use rateLimitAsync.
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: max - 1 };
  }

  if (bucket.count >= max) {
    return {
      success: false,
      remaining: 0,
      retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { success: true, remaining: max - bucket.count };
}

/** Logs a failing shared store at most once a minute, so an outage doesn't flood the logs. */
const STORE_ERROR_LOG_INTERVAL_MS = 60_000;
let lastStoreErrorLogAt = 0;

function logStoreFailure(err: unknown): void {
  const now = Date.now();
  if (now - lastStoreErrorLogAt < STORE_ERROR_LOG_INTERVAL_MS) return;
  lastStoreErrorLogAt = now;
  console.warn(
    "[rate-limit] shared store unavailable; limiting from memory:",
    err instanceof Error ? err.message : err
  );
}

/**
 * Async rate-limit check that works with any RateLimitStore, including Redis.
 * Falls back to the in-memory rateLimit() when no store is provided and
 * RATE_LIMIT_REDIS_URL is not set. It also falls back when the store fails,
 * so an unreachable Redis still answers each request and limits it per
 * instance rather than failing with a 500 (#226).
 */
export async function rateLimitAsync(
  key: string,
  max: number,
  windowMs: number,
  store: RateLimitStore | null = rateLimitStore
): Promise<RateLimitResult> {
  if (!store) return rateLimit(key, max, windowMs);
  let count: number;
  let ttlMs: number;
  try {
    ({ count, ttlMs } = await store.increment(key, windowMs));
  } catch (err) {
    logStoreFailure(err);
    return rateLimit(key, max, windowMs);
  }
  if (count > max) {
    return {
      success: false,
      remaining: 0,
      retryAfter: Math.ceil(ttlMs / 1000),
    };
  }
  return { success: true, remaining: max - count };
}

/**
 * Derive a stable client key from an HTTP request.
 *
 * `X-Forwarded-For` is a client-controlled header; any value it carries is
 * only trustworthy when a known, trusted reverse proxy set it. The
 * `TRUST_PROXY` environment variable opts in to that trust:
 *
 *   - `TRUST_PROXY=1` (or any non-empty, non-"false" string): use the first
 *     value from `X-Forwarded-For`. Set this only when a trusted proxy sits
 *     in front of this server and strips or rewrites the header itself.
 *   - `TRUST_PROXY` unset or `"false"` (the default): ignore the header.
 *     All requests share the key `"direct"` because the App Router does not
 *     expose the raw socket address. Deploy behind a trusted proxy and set
 *     `TRUST_PROXY=1` to get per-IP bucketing in production.
 */
export function getClientKey(req: Request): string {
  const trustProxy =
    process.env.TRUST_PROXY !== undefined &&
    process.env.TRUST_PROXY !== "" &&
    process.env.TRUST_PROXY !== "false";

  if (trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    if (ip) return ip;
  }

  // Without a trusted proxy the socket address is unavailable in App Router.
  // Fall back to a single shared key rather than silently trusting a spoofed
  // header — the per-scope limit still applies, just not per-IP.
  return "direct";
}

/**
 * HTTP-level helper: returns a 429 NextResponse if the caller is over the
 * limit, or null if the request should proceed.
 *
 * Goes through rateLimitAsync, so every route shares the configured store
 * (Redis when RATE_LIMIT_REDIS_URL is set). `store` overrides that store and
 * exists for tests.
 */
export async function rateLimitRequest(
  req: Request,
  opts?: { scope?: string; max?: number; store?: RateLimitStore | null }
): Promise<NextResponse | null> {
  const max = opts?.max ?? DEFAULT_MAX_PER_WINDOW;
  const key = `${opts?.scope ?? "default"}:${getClientKey(req)}`;
  const result = await rateLimitAsync(key, max, WINDOW_MS, opts?.store);

  if (!result.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(result.retryAfter ?? 60) },
      }
    );
  }

  return null;
}
