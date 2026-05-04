/**
 * Telegram webhook endpoint.
 * Telegram POSTs every Update here. Auth via secret token header.
 *
 * Webhook setup (run once after each deploy or via Settings page):
 *   POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *     ?url=https://<domain>/api/telegram
 *     &secret_token=<TELEGRAM_WEBHOOK_SECRET>
 */
import { webhookCallback } from "grammy";
import { getBot } from "@/lib/telegram/bot";

// Disabled body parsing — grammY reads the raw body itself
export const dynamic = "force-dynamic";

const handler = webhookCallback(getBot(), "std/http", {
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}

export async function GET(): Promise<Response> {
  // Helpful when poking the URL in a browser
  return new Response(
    JSON.stringify({ status: "ready", bot: "TheBaseofKnowladge_bot" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
