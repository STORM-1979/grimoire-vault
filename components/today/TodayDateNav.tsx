"use client";

import { useRouter } from "next/navigation";

/**
 * ← Previous day / Today / Next day → shortcut row.  Server component
 * passes the current `?d=` so we can build adjacent links without
 * recomputing in the page component.
 */
export function TodayDateNav({ currentDate }: { currentDate: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const prev = addDays(currentDate, -1);
  const next = addDays(currentDate, 1);
  const isToday = currentDate === today;
  const isFuture = next > today;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => router.push(`/today?d=${prev}`)}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40 transition flex items-center gap-1.5"
      >
        ← {prettyShort(prev)}
      </button>
      {!isToday && (
        <button
          type="button"
          onClick={() => router.push(`/today`)}
          className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full bg-gold text-emerald-deep hover:bg-emerald-100 transition"
        >
          Сегодня
        </button>
      )}
      <button
        type="button"
        onClick={() => !isFuture && router.push(`/today?d=${next}`)}
        disabled={isFuture}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1.5"
      >
        {prettyShort(next)} →
      </button>
    </div>
  );
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function prettyShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString("ru", { day: "numeric", month: "short" });
}
