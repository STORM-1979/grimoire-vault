import { Suspense } from "react";
import Link from "next/link";
import { CATEGORIES } from "@/lib/categories";
import { categoryCounts } from "@/lib/data/entries";
import { Icon } from "@/components/icons/Icon";
import { AnalogClock } from "@/components/home/AnalogClock";
import { MonthCalendar } from "@/components/home/MonthCalendar";
import { QuickLinks } from "@/components/home/QuickLinks";

/**
 * Home is a Server Component.  Layout:
 *   1. Hero: month calendar (left) + analog clock (right).  Both
 *      stretch to the same height via items-stretch + h-full on
 *      the calendar; the clock SVG scales by its own height to
 *      match.
 *   2. Categories: simple heading + 4-col grid of all 15 rooms.
 *
 * The marketing copy ("Fifteen rooms of one library", recent-
 * entries strip) was removed by request — this is a working
 * dashboard, not a landing page.
 */
export default function HomePage() {
  return (
    <div className="fade-in">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
        <div className="max-w-[1480px] mx-auto px-10 pt-12 pb-16 grid grid-cols-12 gap-10 relative items-stretch">
          {/* Calendar — left column, natural content height drives
              the row height.  Today is gold-filled; clicked dates
              get a thin gold ring (selection is local-only for now). */}
          <div className="col-span-5">
            <MonthCalendar />
          </div>
          {/* Clock — right column, scales by height to match the
              calendar.  Container is h-full + flex-centred so the
              SVG sits dead-centre regardless of column width. */}
          <div className="col-span-7 flex items-center justify-center h-full">
            <AnalogClock />
          </div>
        </div>
      </section>

      {/* External dock — one-click jumps to GitHub / Railway /
          Vercel / Supabase and the (still-pending) portfolio site. */}
      <QuickLinks />

      {/* Categories — single-heading section, grid streams in below */}
      <section className="max-w-[1480px] mx-auto px-10 pt-8 pb-16">
        <h2 className="font-display text-[68px] font-light leading-[0.92] tracking-tightest mb-10">
          Категории
        </h2>

        <Suspense fallback={<CategoriesGridSkeleton />}>
          <CategoriesGrid />
        </Suspense>
      </section>
    </div>
  );
}

/* ---- Async subcomponents ---- */

async function loadCounts(): Promise<Record<string, number>> {
  // Server-side aggregation via Postgres function — single round-trip, no per-row payload.
  try {
    return await categoryCounts();
  } catch {
    return {};
  }
}

async function CategoriesGrid() {
  const counts = await loadCounts();
  return (
    <div className="grid grid-cols-4 gap-px bg-white/10 border border-white/10 rounded-2xl overflow-hidden">
      {CATEGORIES.map((c) => (
        <Link
          key={c.id}
          href={`/category/${c.id}`}
          className="group block p-7 relative bg-emerald-deep/60 hover:bg-white/[0.06] transition"
        >
          <div className="flex items-start justify-between mb-7">
            <span className="font-mono text-[11px] uppercase tracking-widest text-gold">№ {c.no}</span>
            <span className="font-mono text-[14px] text-gold opacity-60 group-hover:opacity-100 transition">→</span>
          </div>
          <div className="text-emerald-200 mb-6 group-hover:text-gold transition-colors">
            <Icon name={c.icon} size={34} />
          </div>
          <h3 className="font-display text-[26px] font-medium leading-none text-ivory group-hover:text-emerald-200 transition">
            {c.en}
          </h3>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">
            {c.ru}
          </div>
          <div className="flex justify-between items-baseline mt-6 pt-3 border-t border-white/10">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
              {counts[c.id] ?? 0} записей
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ---- Skeletons (rendered while DB query is in-flight) ---- */

function CategoriesGridSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-px bg-white/10 border border-white/10 rounded-2xl overflow-hidden">
      {CATEGORIES.map((c) => (
        <div key={c.id} className="block p-7 relative bg-emerald-deep/60">
          <div className="flex items-start justify-between mb-7">
            <span className="font-mono text-[11px] uppercase tracking-widest text-gold">№ {c.no}</span>
          </div>
          <div className="text-emerald-200 mb-6"><Icon name={c.icon} size={34} /></div>
          <h3 className="font-display text-[26px] font-medium leading-none">{c.en}</h3>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">{c.ru}</div>
          <div className="flex items-baseline mt-6 pt-3 border-t border-white/10 animate-pulse">
            <span className="h-3 w-12 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}
