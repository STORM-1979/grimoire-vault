import { NextResponse } from "next/server";
import { requireUser, withErrorHandler } from "@/lib/api-helpers";
import { pushToUser } from "@/lib/push";

export const runtime = "nodejs";

/**
 * POST /api/push/test — fires a one-off "ping" notification at every
 * subscription the calling user has registered.  Used by the Settings
 * UI to confirm the round-trip works without waiting for a real bot
 * import or background event.
 */
export const POST = withErrorHandler(async () => {
  const user = await requireUser();
  const r = await pushToUser(user.id, {
    title: "Grimoire Vault",
    body: "Тестовое уведомление — push настроен и работает.",
    url: "/settings",
    tag: "push-test",
  });
  return NextResponse.json(r);
});
