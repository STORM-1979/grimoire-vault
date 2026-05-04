import "server-only";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Per-user, per-endpoint rate limiter.
 *
 * Two backends, picked at boot from env:
 *
 *   1. Upstash Redis (preferred when `UPSTASH_REDIS_REST_URL` +
 *      `UPSTASH_REDIS_REST_TOKEN` are set).  Sliding-window counters in
 *      Redis are consistent across function instances and regions, so
 *      this is the real abuse-prevention story.
 *
 *   2. In-memory token bucket (fallback).  Each Vercel lambda holds its
 *      own counter — fine for personal use to catch accidental retry
 *      loops, but a determined adversary can spread requests across
 *      cold-started instances.
 *
 * `checkRateLimit()` keeps the same shape under either backend so call
 * sites don't change.  The chosen backend is logged once on first use.
 */

interface Limit {
  /** Maximum burst — also the initial number of tokens for in-memory. */
  capacity: number;
  /** Steady-state rate (tokens per second). */
  refillPerSec: number;
}

/**
 * Standard limit profiles — change once, applies everywhere.  Each scope
 * also carries the strings used to label the Upstash sliding window
 * (`<count> <unit>`) since `@upstash/ratelimit` wants a windowing string.
 */
export const RATE_LIMITS = {
  exportLight:    { capacity: 10, refillPerSec: 10 / 3600, perWindow: { tokens: 10, window: "1 h"  as const } },
  exportFull:     { capacity: 3,  refillPerSec: 3  / 3600, perWindow: { tokens: 3,  window: "1 h"  as const } },
  importVault:    { capacity: 5,  refillPerSec: 5  / 3600, perWindow: { tokens: 5,  window: "1 h"  as const } },
  ogExtract:      { capacity: 30, refillPerSec: 30 / 60,   perWindow: { tokens: 30, window: "1 m"  as const } },
  semanticSearch: { capacity: 60, refillPerSec: 60 / 60,   perWindow: { tokens: 60, window: "1 m"  as const } },
  vaultInvite:    { capacity: 10, refillPerSec: 10 / 3600, perWindow: { tokens: 10, window: "1 h"  as const } },
  pushSubscribe:  { capacity: 10, refillPerSec: 10 / 60,   perWindow: { tokens: 10, window: "1 m"  as const } },
} as const;

type LimitProfile = typeof RATE_LIMITS[keyof typeof RATE_LIMITS];

/* ---------- In-memory backend (fallback) ---------- */

interface Bucket { tokens: number; last: number }
const buckets = new Map<string, Bucket>();
let lastGc = 0;
function gcMemory(now: number) {
  if (now - lastGc < 60_000) return;
  lastGc = now;
  for (const [k, b] of buckets) {
    if (now - b.last > 60 * 60 * 1000) buckets.delete(k);
  }
}
function takeTokenMemory(key: string, limit: Limit): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  gcMemory(now);
  const existing = buckets.get(key);
  const b: Bucket = existing ?? { tokens: limit.capacity, last: now };
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(limit.capacity, b.tokens + elapsed * limit.refillPerSec);
  b.last = now;
  if (b.tokens < 1) {
    const needed = 1 - b.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(needed / limit.refillPerSec));
    buckets.set(key, b);
    return { allowed: false, retryAfterSec };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { allowed: true, retryAfterSec: 0 };
}

/* ---------- Upstash backend ---------- */

let _redis: Redis | null = null;
const upstashByScope = new Map<string, Ratelimit>();
const ENABLED = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);
let backendLogged = false;

function redis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

function getUpstashLimiter(scope: string, profile: LimitProfile): Ratelimit {
  let rl = upstashByScope.get(scope);
  if (!rl) {
    rl = new Ratelimit({
      redis: redis(),
      // Sliding window matches "N requests over T" semantics most users
      // expect — token bucket gives slightly different burst behaviour.
      limiter: Ratelimit.slidingWindow(profile.perWindow.tokens, profile.perWindow.window),
      // `prefix` namespaces keys so dev/prod (or two deploys against the
      // same Redis) don't share counters by accident.
      prefix: `gv:rl:${scope}`,
      analytics: false,
    });
    upstashByScope.set(scope, rl);
  }
  return rl;
}

/* ---------- Public API ---------- */

/**
 * Check the rate limit for `(userId, scope)`.  Returns a 429 NextResponse
 * if the limit is exceeded; null if the caller should proceed.
 *
 * Both backends share this shape; the only knob you have to set is the
 * env vars — code paths don't need to know which one is active.
 */
export async function checkRateLimit(
  userId: string,
  scope: string,
  profile: LimitProfile,
): Promise<NextResponse | null> {
  if (!backendLogged) {
    backendLogged = true;
    console.log(JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      msg: "rate-limit backend",
      backend: ENABLED ? "upstash" : "memory",
    }));
  }

  let allowed: boolean;
  let retryAfterSec: number;

  if (ENABLED) {
    try {
      const rl = getUpstashLimiter(scope, profile);
      const r = await rl.limit(userId);
      allowed = r.success;
      retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    } catch (e) {
      // Upstash hiccup — fail open rather than locking everyone out.
      // The next request will retry and likely succeed.
      console.warn(JSON.stringify({
        level: "warn", ts: new Date().toISOString(),
        msg: "upstash ratelimit error; failing open",
        error: e instanceof Error ? e.message : String(e),
      }));
      return null;
    }
  } else {
    const r = takeTokenMemory(`${userId}:${scope}`, profile);
    allowed = r.allowed;
    retryAfterSec = r.retryAfterSec;
  }

  if (allowed) return null;
  return NextResponse.json(
    {
      error: `Слишком часто. Подожди ${retryAfterSec} с и попробуй ещё раз.`,
      retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "Cache-Control": "no-store",
      },
    },
  );
}
