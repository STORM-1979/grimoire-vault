import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, withErrorHandler, parseBody } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * POST   /api/push/subscribe — register a browser PushSubscription
 * DELETE /api/push/subscribe — unregister (body: {endpoint})
 *
 * The browser calls these via the Settings → Notifications toggle.
 * Endpoint is unique on the table, so re-subscribing the same device
 * upserts cleanly.
 */

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(8).max(200),
    auth: z.string().min(8).max(100),
  }),
  userAgent: z.string().max(500).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export const POST = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const limited = await checkRateLimit(user.id, "push-subscribe", RATE_LIMITS.pushSubscribe);
  if (limited) return limited;
  const body = await parseBody(request, subscribeSchema);
  const svc = createServiceClient();
  const { error } = await svc
    .from("push_subscriptions")
    .upsert({
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth_key: body.keys.auth,
      user_agent: body.userAgent ?? null,
    }, { onConflict: "endpoint" });
  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true });
});

export const DELETE = withErrorHandler(async (request: Request) => {
  const user = await requireUser();
  const body = await parseBody(request, unsubscribeSchema);
  const svc = createServiceClient();
  const { error } = await svc
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", body.endpoint);
  if (error) throw new Error(error.message);
  return NextResponse.json({ ok: true });
});
