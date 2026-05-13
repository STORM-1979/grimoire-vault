/**
 * Cron-triggered morning digest.
 * Vercel cron header `Authorization: Bearer <CRON_SECRET>` is set automatically;
 * we cross-check with TELEGRAM_WEBHOOK_SECRET for symmetry.
 *
 * For local testing:
 *   curl -X POST http://localhost:3000/api/telegram/digest \
 *     -H "Authorization: Bearer $TELEGRAM_WEBHOOK_SECRET"
 */
import { NextResponse } from "next/server";
import { Bot } from "grammy";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface DigestRow {
  user_id: string;
  telegram_chat_id: number;
}

export async function POST(request: Request): Promise<Response> {
  // Auth: only the Bearer secret counts.  The previous version
  // also accepted any request whose User-Agent included
  // "vercel-cron" — a header any client can spoof, which let an
  // attacker trigger digest blasts at will (DoS the bot, hit
  // Telegram rate limits, push noise to every linked chat).
  // Vercel's cron does send the Authorization: Bearer header
  // configured on the project, so dropping the UA fast-path
  // costs us nothing while closing the bypass.
  const auth = request.headers.get("authorization") ?? "";
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
    ? `Bearer ${process.env.TELEGRAM_WEBHOOK_SECRET}`
    : null;
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "no token" }, { status: 500 });

  const bot = new Bot(token);
  const svc = createServiceClient();

  // Pull all linked sessions (filter out negative placeholder ids)
  const { data: sessions } = await svc
    .from("telegram_sessions")
    .select("user_id, telegram_chat_id")
    .gt("telegram_chat_id", 0);

  const summary: Array<{ userId: string; chatId: number; sent: boolean; error?: string }> = [];

  for (const s of (sessions ?? []) as DigestRow[]) {
    try {
      // Pull morning-relevant data: ideas added last 24h, kanban "doing" + overdue
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

      const { data: newIdeas } = await svc
        .from("entries")
        .select("title")
        .eq("user_id", s.user_id)
        .eq("category_id", "ideas")
        .gte("created_at", since)
        .limit(5);

      const today = new Date().toISOString().slice(0, 10);
      const { data: doing } = await svc
        .from("kanban_cards")
        .select("title, due_date")
        .eq("user_id", s.user_id)
        .eq("column_name", "doing")
        .order("due_date", { ascending: true })
        .limit(10);

      const overdue = (doing ?? []).filter((c) => c.due_date && c.due_date < today);
      const upcoming = (doing ?? []).filter((c) => !overdue.includes(c));

      const lines: string[] = [];
      lines.push("☀️ *Утренний дайджест*");
      lines.push("");
      if (newIdeas && newIdeas.length > 0) {
        lines.push(`💡 Новые идеи (${newIdeas.length}):`);
        for (const n of newIdeas) lines.push(`• ${escapeMd(n.title)}`);
        lines.push("");
      }
      if (overdue.length > 0) {
        lines.push(`🔴 Просрочено в Канбане (${overdue.length}):`);
        for (const c of overdue) lines.push(`• ${escapeMd(c.title)} — _${c.due_date}_`);
        lines.push("");
      }
      if (upcoming.length > 0) {
        lines.push(`▶️ В работе (${upcoming.length}):`);
        for (const c of upcoming.slice(0, 5)) lines.push(`• ${escapeMd(c.title)}${c.due_date ? ` — _${c.due_date}_` : ""}`);
        lines.push("");
      }
      if (lines.length === 2) {
        lines.push("Сегодня всё спокойно. Никаких просроченных задач, никаких новых идей за ночь.");
      }

      await bot.api.sendMessage(s.telegram_chat_id, lines.join("\n"), { parse_mode: "Markdown" });
      summary.push({ userId: s.user_id, chatId: s.telegram_chat_id, sent: true });
    } catch (e) {
      summary.push({
        userId: s.user_id,
        chatId: s.telegram_chat_id,
        sent: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ ok: true, count: summary.length, summary });
}

function escapeMd(s: string): string {
  return s.replace(/[*_`[\]]/g, "\\$&");
}
