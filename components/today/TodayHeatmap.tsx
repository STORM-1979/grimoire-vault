"use client";

import Link from "next/link";

/**
 * 90-day activity heatmap.  GitHub-contribution-style: each day is a
 * 12×12 cell, opacity scaled to the day's entry count vs the 90-day
 * peak.  Hover shows the count + clickable date.
 *
 * Layout: 13 columns × 7 rows (≈ 91 days).  We render the start
 * column as the oldest, so today sits in the bottom-right.  The
 * column/row counting is done off the start ISO date so DST doesn't
 * shift cells.
 */
export function TodayHeatmap({
  counts,
  start,
  end,
}: {
  counts: Record<string, number>;
  start: string; // ISO day
  end: string;   // ISO day (today by default)
}) {
  // Build the day list from `start` through `end` inclusive.
  const days: string[] = [];
  let d = isoToDate(start);
  const endD = isoToDate(end);
  while (d <= endD) {
    days.push(dateToIso(d));
    d = new Date(d.getTime() + 86400000);
  }
  const peak = Math.max(1, ...Object.values(counts));

  // Group days into weeks by Monday-anchored start-of-week.  We render
  // columns left-to-right, oldest first.
  const weeks: string[][] = [];
  let week: string[] = [];
  for (const day of days) {
    const dow = (isoToDate(day).getUTCDay() + 6) % 7; // 0 = Mon
    if (dow === 0 && week.length) {
      weeks.push(week);
      week = [];
    }
    week.push(day);
  }
  if (week.length) weeks.push(week);

  return (
    <div className="mt-6">
      <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mb-2">
        90 дней активности · {Object.values(counts).reduce((s, n) => s + n, 0)} записей
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {weeks.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {wk.map((day) => {
              const n = counts[day] ?? 0;
              const intensity = n === 0 ? 0 : Math.max(0.15, Math.min(1, n / peak));
              const bg = n === 0
                ? "rgba(255,255,255,0.04)"
                : `rgba(212,183,106,${intensity})`;
              return (
                <Link
                  key={day}
                  href={`/today?d=${day}`}
                  title={`${day} · ${n} ${plural(n)}`}
                  style={{ backgroundColor: bg }}
                  className="block w-3 h-3 rounded-sm border border-white/5 hover:ring-1 hover:ring-gold/60 transition"
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 font-mono text-[8px] uppercase tracking-widest text-ivory-mute">
        <span>тише</span>
        <div className="flex gap-1">
          {[0, 0.25, 0.5, 0.75, 1].map((i) => (
            <div
              key={i}
              style={{
                backgroundColor: i === 0
                  ? "rgba(255,255,255,0.04)"
                  : `rgba(212,183,106,${Math.max(0.15, i)})`,
              }}
              className="w-3 h-3 rounded-sm border border-white/5"
            />
          ))}
        </div>
        <span>чаще</span>
      </div>
    </div>
  );
}

function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return "записей";
  if (m10 === 1) return "запись";
  if (m10 >= 2 && m10 <= 4) return "записи";
  return "записей";
}
