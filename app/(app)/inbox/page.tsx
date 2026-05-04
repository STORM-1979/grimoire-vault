import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icons/Icon";
import { InboxView } from "@/components/inbox/InboxView";

export default async function InboxPage() {
  const supabase = await createClient();

  // Real telegram session
  const { data: session } = await supabase
    .from("telegram_sessions")
    .select("telegram_chat_id, link_code, link_code_expires, updated_at")
    .gt("telegram_chat_id", 0)
    .maybeSingle();

  // Quick stats — pull lightweight aggregate counts so the hero paints fast.
  // The interactive list below fetches its own paginated data client-side.
  const [{ count: pendingCount }, { count: triagedCount }, { data: todayRows }] = await Promise.all([
    supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("imported_via", "bot")
      .is("triaged_at", null),
    supabase
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("imported_via", "bot")
      .filter("triaged_at", "not.is", "null"),
    supabase
      .from("entries")
      .select("id, created_at")
      .eq("imported_via", "bot")
      .gte("created_at", new Date(new Date().toISOString().slice(0, 10)).toISOString())
      .limit(200),
  ]);

  const todays = todayRows?.length ?? 0;

  return (
    <div className="fade-in">
      <section className="max-w-[1180px] mx-auto px-10 pt-12 pb-8 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Index</Link>
          <span>/</span>
          <span className="text-gold">Inbox · Telegram</span>
        </div>

        <div className="flex items-end justify-between gap-8 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2 flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${session ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              {session ? "Bot online · webhook active" : "Bot not linked"}
            </div>
            <h1 className="font-display text-[80px] font-light leading-[0.92] tracking-tightest">
              Telegram <span className="italic text-gold">Inbox</span>
            </h1>
            <p className="text-[15px] text-ivory-dim mt-3 max-w-2xl">
              Бот валит сюда всё подряд. Подтверди категорию одним кликом,
              перемести в правильную, или удали — пока не закроешь до нуля.
            </p>
          </div>

          <div className="flex items-end gap-3">
            <div className="keynote text-center min-w-[110px] p-4">
              <div className="font-display text-[32px] font-light text-gold leading-none">{pendingCount ?? 0}</div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Pending</div>
            </div>
            <div className="keynote text-center min-w-[110px] p-4">
              <div className="font-display text-[32px] font-light text-gold leading-none">{triagedCount ?? 0}</div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Triaged</div>
            </div>
            <div className="keynote text-center min-w-[110px] p-4">
              <div className="font-display text-[32px] font-light text-gold leading-none">{todays}</div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Today</div>
            </div>
          </div>
        </div>
      </section>

      {!session && (
        <section className="max-w-[1180px] mx-auto px-10 py-8">
          <div className="keynote rounded-xl p-6">
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2 flex items-center gap-2">
              <Icon name="shield" size={11} /> Setup
            </div>
            <p className="text-[14px] text-ivory-dim leading-snug">
              Чтобы получать сообщения с любого устройства — открой
              <Link href="/settings" className="text-gold mx-1 hover:underline">Settings → Telegram</Link>
              и привяжи свой чат коротким кодом.
            </p>
          </div>
        </section>
      )}

      <InboxView />
    </div>
  );
}
