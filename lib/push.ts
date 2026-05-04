import "server-only";
import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Web Push wrapper.
 *
 * Configuration: VAPID keypair lives in env (see .env.example).
 *   • VAPID_PUBLIC_KEY  — also exposed to the browser as
 *                         NEXT_PUBLIC_VAPID_PUBLIC_KEY
 *   • VAPID_PRIVATE_KEY — server-only, never sent to client
 *   • VAPID_SUBJECT     — `mailto:you@example.com` per RFC 8292
 *
 * If any are missing this module no-ops on send (returns 0 sent), so
 * partial deploys don't crash.  Subscriptions still persist; once env
 * is set, sends start working.
 */

let configured = false;

function configure(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const prv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT ?? "mailto:noreply@grimoire-vault.vercel.app";
  if (!pub || !prv) return false;
  webpush.setVapidDetails(subj, pub, prv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;        // path to navigate to on click (defaults to "/")
  tag?: string;        // dedup tag — same tag replaces an unread notification
  icon?: string;
  badge?: string;
}

interface PushResult { sent: number; pruned: number; errors: number }

/**
 * Send a notification to every active subscription for `userId`.
 *
 * Stale endpoints (410 Gone / 404 Not Found) are cleaned up automatically
 * — push services tell us when a permission was revoked, and we trust
 * them.  Other 4xx/5xx are logged but the subscription is kept.
 */
export async function pushToUser(userId: string, payload: PushPayload): Promise<PushResult> {
  if (!configure()) {
    return { sent: 0, pruned: 0, errors: 0 };
  }
  const svc = createServiceClient();
  const { data: subs, error } = await svc
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key")
    .eq("user_id", userId);
  if (error || !subs?.length) return { sent: 0, pruned: 0, errors: 0 };

  let sent = 0, pruned = 0, errors = 0;
  const stale: string[] = [];

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: s.endpoint as string,
          keys: { p256dh: s.p256dh as string, auth: s.auth_key as string },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 }, // 24 h — typical "you got mail" use case
      );
      sent += 1;
      // Refresh last_used_at so admin can see active devices
      await svc.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        stale.push(s.id as string);
      } else {
        errors += 1;
        console.warn("[push] send failed", { id: s.id, status, msg: (e as Error)?.message });
      }
    }
  }));

  if (stale.length > 0) {
    await svc.from("push_subscriptions").delete().in("id", stale);
    pruned = stale.length;
  }
  return { sent, pruned, errors };
}
