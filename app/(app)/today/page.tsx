import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { rowToEntry } from "@/lib/data/mappers";
import { getCategory } from "@/lib/categories";
import { Icon } from "@/components/icons/Icon";
import { formatDateTime } from "@/lib/utils";
import { TodayHeatmap } from "@/components/today/TodayHeatmap";
import { TodayDateNav } from "@/components/today/TodayDateNav";
import type { Entry } from "@/lib/types";

/**
 * /today — daily journal view.  Shows everything captured on a given
 * date (defaults to today) chronologically, plus a 90-day heatmap of
 * activity at the top so the user can navigate to any past day.
 *
 *   ?d=2026-05-07  → that specific day
 *   no param        → today (server-rendered with the user's UTC date;
 *                     client component on the page reconciles to the
 *                     local time zone via a small re-fetch hint).
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;
  const targetDate = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayUtc();
  const supabase = await createClient();

  // Fetch entries created on the target day.  The DB stores UTC; for
  // a personal-vault audience this is good enough — most edits live
  // in one TZ anyway.  If TZ mismatches become annoying we add a
  // user_profiles.timezone column.
  const start = `${targetDate}T00:00:00.000Z`;
  const end = `${targetDate}T23:59:59.999Z`;
  const { data: rows } = await supabase
    .from("entries")
    .select("*")
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: true });
  const entries: Entry[] = (rows ?? []).map(rowToEntry);

  // Fetch a 90-day window of counts for the heatmap. We pull only
  // the `created_at` column (8 bytes per row over the wire) and
  // group by date in JS — for typical personal vaults (10-200
  // entries/day max) this beats a server-side GROUP BY round-trip.
  // The new entries_user_created_idx covers the predicate path so
  // the read is index-only.
  const heatmapStart = isoDateAddDays(targetDate, -89);
  const { data: heatRows } = await supabase
    .from("entries")
    .select("created_at")
    .gte("created_at", `${heatmapStart}T00:00:00.000Z`)
    .lte("created_at", `${targetDate}T23:59:59.999Z`)
    .limit(10000); // safety cap — heatmap doesn't need precision past this
  const heatCounts: Record<string, number> = {};
  for (const r of heatRows ?? []) {
    const day = (r.created_at as string).slice(0, 10);
    heatCounts[day] = (heatCounts[day] ?? 0) + 1;
  }

  return (
    <div className="fade-in">
      <section className="max-w-[1080px] mx-auto px-10 pt-12 pb-6 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Главная</Link>
          <span>/</span>
          <span className="text-gold">Сегодня</span>
        </div>

        <div className="flex items-end gap-7 mb-7">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
              Daily journal · {entries.length} записей
            </div>
            <h1 className="font-display text-[64px] font-light leading-[0.95] tracking-tightest">
              {prettyDate(targetDate)}
            </h1>
          </div>
        </div>

        <TodayDateNav currentDate={targetDate} />
        <TodayHeatmap
          counts={heatCounts}
          start={heatmapStart}
          end={targetDate}
        />
      </section>

      <section className="max-w-[1080px] mx-auto px-10 py-10">
        {entries.length === 0 ? (
          <div className="text-center py-32">
            <div className="text-ivory-mute font-light italic mb-4">
              — за этот день записей нет —
            </div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
              ⌘⇧N — записать прямо сейчас
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => {
              const cat = getCategory(entry.categoryId);
              return (
                <Link
                  key={entry.id}
                  href={`/entry/${entry.id}`}
                  className="block rounded-lg border border-white/10 hover:border-gold/40 hover:bg-white/[0.03] transition p-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="text-emerald-200 mt-1 flex-shrink-0">
                      {cat && <Icon name={cat.icon} size={22} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-mono text-[9px] uppercase tracking-widest text-gold">
                          {cat ? `№ ${cat.no} · ${cat.en}` : entry.categoryId}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                          {formatDateTime(entry.createdAt)}
                        </span>
                        {entry.pinned && (
                          <Icon name="pinFilled" size={10} className="text-gold" />
                        )}
                      </div>
                      <h3 className="font-medium text-[16px] mb-1 truncate">{entry.title}</h3>
                      {entry.description && (
                        <p className="text-[13px] text-ivory-dim leading-snug font-light line-clamp-2 mb-2">
                          {entry.description}
                        </p>
                      )}
                      {entry.tags.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {entry.tags.slice(0, 5).map((t) => (
                            <span key={t} className="tag-soft">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- helpers ---------- */

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDateAddDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const today = todayUtc();
  const yesterday = isoDateAddDays(today, -1);
  if (iso === today) return "Сегодня";
  if (iso === yesterday) return "Вчера";
  return d.toLocaleDateString("ru", { day: "numeric", month: "long", year: "numeric" });
}
