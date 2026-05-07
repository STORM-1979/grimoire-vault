import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { createClient } from "@/lib/supabase/server";
import { DataError } from "@/lib/errors";
import { log } from "@/lib/log";

/** Standard JSON error response. */
export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Resolve current user or 401. */
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new HttpError("Unauthorized", 401);
  return user;
}

/**
 * Resolve user from EITHER cookie session OR `Authorization: Bearer
 * <pat>` header.  Used by the v1 REST API so iOS Shortcuts / Zapier
 * / curl can call the same endpoints the browser uses.  The token is
 * matched by SHA-256 against `personal_access_tokens.token_hash`.
 *
 * Falls back to cookie auth when the header is absent so a route
 * mounted under v1 can still serve a logged-in browser.
 */
export async function requireUserFlexible() {
  const supabase = await createClient();
  const { data: { user: cookieUser } } = await supabase.auth.getUser();
  if (cookieUser) return cookieUser;

  // Cookie miss — try Bearer token.  Read the header from the
  // request via the `headers()` helper imported lazily so this
  // function stays callable from contexts where the header isn't
  // available (e.g. server actions).
  const { headers } = await import("next/headers");
  const h = await headers();
  const auth = h.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError("Unauthorized", 401);
  const token = auth.slice(7).trim();
  if (!token) throw new HttpError("Unauthorized", 401);

  // Hash with Web Crypto and look up.  We use the service-role
  // client for this query so RLS doesn't block (no user session yet).
  const { createServiceClient } = await import("@/lib/supabase/server");
  const svc = createServiceClient();
  const hash = await sha256Hex(token);
  const { data: row, error } = await svc
    .from("personal_access_tokens")
    .select("user_id")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !row) throw new HttpError("Unauthorized", 401);

  // Touch last_used_at fire-and-forget so the user can audit which
  // tokens are alive.
  void svc
    .from("personal_access_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", hash);

  // Hydrate the auth.users row so callers get the same shape as
  // requireUser().
  const { data: { user } } = await svc.auth.admin.getUserById(row.user_id);
  if (!user) throw new HttpError("Unauthorized", 401);
  return user;
}

/** SHA-256 → hex via Web Crypto. */
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Parse JSON body with Zod schema, throwing 400 on failure. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError("Body must be valid JSON", 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError("Invalid request body", 400, { issues: result.error.issues });
  }
  return result.data;
}

/** Parse query string with Zod schema. */
export function parseQuery<T>(url: string, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    throw new HttpError("Invalid query string", 400, { issues: result.error.issues });
  }
  return result.data;
}

export class HttpError extends Error {
  constructor(message: string, public status = 500, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/**
 * Wrap an async route handler with uniform error handling + observability.
 *
 *   • Each invocation gets a fresh `requestId` (UUID).
 *   • Wall-clock duration is measured and logged on every request — both
 *     happy and sad paths.  Vercel's Logs Explorer indexes `durationMs`
 *     so I can compute p50/p95 per route over time without any extra
 *     stack.
 *   • Levels by status:
 *       2xx/3xx → `info`     ("request", durationMs, status)
 *       4xx     → `warn`     (no stack — user-input issue, not a bug)
 *       5xx     → `error`    (includes `stack` if available)
 *   • The error response body always carries `requestId`, and the
 *     `X-Request-Id` header lets the caller copy it from DevTools
 *     without scrolling through the body.  When the user reports a
 *     bug, that's the single string to grep in Vercel logs.
 *
 * Volume note: every API call emits exactly one log line.  At a few
 * thousand requests/day for a personal vault this is well inside
 * Vercel's free tier log budget; if it ever isn't, the obvious knob
 * is to skip the info-level success logs and keep just warnings/errors.
 */
export function withErrorHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
) {
  return async (...args: Args): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    // Best-effort route extraction: first arg is usually the Request.
    const req = args[0] as { url?: string; method?: string } | undefined;
    let route = "unknown";
    try { if (req?.url) route = new URL(req.url).pathname; } catch { /* ignore */ }
    const method = req?.method ?? "GET";

    let status = 200;
    let response: Response;
    let errMessage: string | undefined;
    let errStack: string | undefined;
    let errIssues: unknown;

    try {
      response = await handler(...args);
      status = response.status;
    } catch (err: unknown) {
      let body: Record<string, unknown> = { error: "Unexpected error" };

      if (err instanceof HttpError) {
        status = err.status;
        body = { error: err.message, ...(err.extra ?? {}) };
      } else if (err instanceof DataError) {
        status = err.status;
        body = { error: err.message, ...(err.extra ?? {}) };
      } else if (err instanceof ZodError) {
        status = 400;
        body = { error: "Validation failed", issues: err.issues };
        errIssues = err.issues.map((i) => ({ path: i.path, code: i.code }));
      } else if (err instanceof Error) {
        status = 500;
        body = { error: err.message };
        errStack = err.stack;
      } else {
        status = 500;
      }

      errMessage = body.error as string;
      body.requestId = requestId;
      response = NextResponse.json(body, {
        status,
        headers: {
          "X-Request-Id": requestId,
          "Cache-Control": "no-store",
        },
      });
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const fields: Record<string, unknown> = { requestId, route, method, status, durationMs };
    if (errIssues) fields.issues = errIssues;

    if (status >= 500) {
      if (errStack) fields.stack = errStack;
      log.error(errMessage ?? "5xx response", fields);
    } else if (status >= 400) {
      log.warn(errMessage ?? "4xx response", fields);
    } else {
      log.info("request", fields);
    }

    return response;
  };
}
