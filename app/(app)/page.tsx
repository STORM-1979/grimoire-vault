import { Suspense } from "react";
import Link from "next/link";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { categoryCounts } from "@/lib/data/entries";
import { createClient } from "@/lib/supabase/server";
import { rowToEntry } from "@/lib/data/mappers";
import { Icon } from "@/components/icons/Icon";
import { AnalogClock } from "@/components/home/AnalogClock";
import { MonthCalendar } from "@/components/home/MonthCalendar";

/**
 * Home is a Server Component.  The hero is now a clean two-column
 * panel — analog clock on the left, month calendar on the right —
 * both live, both client-rendered.  Below it the "Recently added"
 * strip and the categories grid still stream in via Suspense.
 *
 * Why this hero instead of the old marketing copy: this is a
 * personal vault, the user lives here every day, and "A library of
 * everything worth keeping" earns its keep on a landing page, not
 * on a working dashboard.  Clock + calendar give the page a
 * functional anchor and a daily rhythm without nagging the user
 * about anything.
 */
export default function HomePage() {
  return (
    <div className="fade-in">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
        <div className="max-w-[1480px] mx-auto px-10 pt-12 pb-16 grid grid-cols-12 gap-10 relative items-center">
          {/* Clock — gets the wider column and centres in it.
              Without the strap-lugs the case sits more like an
              independent object, so we let it breathe. */}
          <div className="col-span-7 flex items-center justify-center">
            <AnalogClock />
          </div>
          {/* Calendar — compact 5/12 column.  Today is gold-filled;
              clicked dates get a thin gold ring (selection is
              local-only for now). */}
          <div className="col-span-5">
            <MonthCalendar />
          </div>
        </div>
      </section>

      {/* Recently added — RSC + Suspense, paints under the hero independently */}
      <section className="max-w-[1480px] mx-auto px-10 pt-12 pb-4">
        <div className="flex items-baseline justify-between mb-5">
          <div className="badge">Recently added</div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
            свежее наверху
          </span>
        </div>
        <Suspense fallback={<RecentEntriesSkeleton />}>
          <RecentEntries />
        </Suspense>
      </section>

      {/* Categories grid — counts stream in below the static labels */}
      <section className="max-w-[1480px] mx-auto px-10 py-16">
        <div className="grid grid-cols-12 gap-10 mb-12">
          <div className="col-span-6">
            <div className="badge mb-4">Указатель — пятнадцать</div>
            <h2 className="font-display text-[68px] font-light leading-[0.92] tracking-tightest">
              Fifteen <span className="italic text-gold">rooms</span> of one library.
            </h2>
          </div>
          <div className="col-span-5 col-start-8 self-end">
            <p className="text-[15px] leading-[1.7] text-ivory-dim font-light">
              Каждая комната — отдельная страница со своим ритмом. Внутри: лента,
              поиск, добавление одной кнопкой, неограниченное вложение подкатегорий.
            </p>
          </div>
        </div>

        <Suspense fallback={<CategoriesGridSkeleton />}>
          <CategoriesGrid />
        </Suspense>
      </section>
    </div>
  );
}

/* ---- Recent entries strip ---- */

async function RecentEntries() {
  const supabase = await createClient();
  // Latest 6 across all 14 categories — RLS scopes to the calling user.
  const { data } = await supabase
    .from("entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6);
  const items = (data ?? []).map(rowToEntry);
  if (items.length === 0) {
    return (
      <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute py-8 text-center border border-dashed border-white/10 rounded-2xl">
        Vault пуст — добавь первую запись через категорию или ⌘K
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((it) => {
        const cat = getCategory(it.categoryId);
        if (!cat) return null;
        return (
          <Link
            key={it.id}
            href={`/category/${cat.id}`}
            className="group flex items-start gap-3 p-3 rounded-xl border border-white/8 bg-white/[0.02] hover:border-gold/40 hover:bg-white/[0.04] transition"
          >
            <div className="text-emerald-200 group-hover:text-gold transition flex-shrink-0 mt-0.5">
              <Icon name={cat.icon} size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-widest text-gold mb-0.5 truncate">
                № {cat.no} · {cat.en}
              </div>
              <div className="font-display text-[15px] font-medium leading-tight truncate">
                {it.title}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">
                {new Date(it.createdAt).toLocaleString("ru-RU", {
                  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                })}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function RecentEntriesSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="p-3 rounded-xl border border-white/8 bg-white/[0.02] animate-pulse min-h-[64px]">
          <div className="h-3 w-16 rounded bg-white/5 mb-2" />
          <div className="h-4 w-3/4 rounded bg-white/5 mb-2" />
          <div className="h-3 w-20 rounded bg-white/5" />
        </div>
      ))}
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
            <span className="font-mono text-[10px] uppercase tracking-widest text-gold">∞ подкат.</span>
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
          <div className="flex justify-between items-baseline mt-6 pt-3 border-t border-white/10 animate-pulse">
            <span className="h-3 w-12 rounded bg-white/10" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-gold opacity-50">∞</span>
          </div>
        </div>
      ))}
    </div>
  );
}
