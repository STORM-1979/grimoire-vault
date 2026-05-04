import { Suspense } from "react";
import Link from "next/link";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { categoryCounts } from "@/lib/data/entries";
import { createClient } from "@/lib/supabase/server";
import { rowToEntry } from "@/lib/data/mappers";
import { Icon } from "@/components/icons/Icon";
import type { CategoryId } from "@/lib/types";

/**
 * Home is a Server Component. Hero (static text) renders immediately;
 * the DB-dependent parts (featured card + per-category counts) stream in
 * via Suspense so first paint is independent of Postgres latency.
 */
export default function HomePage() {
  return (
    <div className="fade-in">
      {/* Hero — pure static text, paints in the first frame */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
        <div className="max-w-[1480px] mx-auto px-10 pt-20 pb-24 grid grid-cols-12 gap-12 relative">
          <div className="col-span-7">
            <div className="badge mb-7">Volume I — A.D. 2026</div>
            <h1 className="font-display tracking-tightest leading-[0.88] font-light">
              <span className="block text-[120px]">A library of</span>
              <span className="block text-[136px] italic font-medium text-gold">everything</span>
              <span className="block text-[120px]">worth keeping.</span>
            </h1>
            <p className="font-display italic font-light text-[22px] text-ivory-dim mt-8 max-w-2xl leading-[1.4]">
              Тринадцать категорий. Один пароль. Один Telegram-нунций.
              Личная база знаний — изящная, тихая, всегда под рукой.
            </p>
            <div className="flex items-center gap-4 mt-9">
              <Link
                href="/categories"
                className="bg-ivory text-emerald-950 px-7 py-3.5 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition flex items-center gap-2"
              >
                Открыть Vault <Icon name="arrow" size={16} />
              </Link>
              <Link
                href="/inbox"
                className="border border-white/30 text-ivory px-7 py-3.5 rounded-full font-medium tracking-tight hover:border-gold hover:text-gold transition"
              >
                Открыть Inbox
              </Link>
            </div>
          </div>

          <aside className="col-span-5 flex flex-col gap-4 self-end min-h-[260px]">
            <Suspense fallback={<FeaturedSkeleton />}>
              <FeaturedCard />
            </Suspense>
          </aside>
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
            <div className="badge mb-4">Указатель — тринадцать</div>
            <h2 className="font-display text-[68px] font-light leading-[0.92] tracking-tightest">
              Thirteen <span className="italic text-gold">rooms</span> of one library.
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
  // Latest 6 across all 13 categories — RLS scopes to the calling user.
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

async function FeaturedCard() {
  const counts = await loadCounts();
  const featuredId = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ideas") as CategoryId;
  const featured = CATEGORIES.find((c) => c.id === featuredId)!;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <Link href={`/category/${featured.id}`} className="keynote p-7 rounded-xl block">
        <div className="flex justify-between items-baseline mb-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold">Featured · максимум записей</div>
          <span className="font-mono text-[10px] text-ivory-mute">№ {featured.no}</span>
        </div>
        <h3 className="font-display italic text-[36px] font-medium leading-none">{featured.en}</h3>
        <p className="text-[14px] leading-snug text-ivory-dim mt-3">
          Самая активная категория. {counts[featured.id] ?? 0} записей.
        </p>
        <div className="hairline-gold my-5" />
        <div className="flex justify-between items-end">
          <div>
            <div className="font-display text-[44px] font-light text-gold leading-none">
              {counts[featured.id] ?? 0}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1">items</div>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-widest text-gold flex items-center gap-1">
            Open <Icon name="arrow" size={14} />
          </span>
        </div>
      </Link>

      <div className="grid grid-cols-3 gap-3">
        <div className="keynote p-4 rounded-lg">
          <div className="font-display text-[28px] font-light text-gold leading-none">13</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-2">Категорий</div>
        </div>
        <div className="keynote p-4 rounded-lg">
          <div className="font-display text-[28px] font-light text-gold leading-none">
            {total.toLocaleString("ru-RU").replace(",", " ")}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-2">Записей</div>
        </div>
        <div className="keynote p-4 rounded-lg">
          <div className="font-display text-[28px] font-light text-gold leading-none">∞</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-2">Подкатегорий</div>
        </div>
      </div>
    </>
  );
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

function FeaturedSkeleton() {
  return (
    <>
      <div className="keynote p-7 rounded-xl block animate-pulse min-h-[220px]">
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold/50 mb-3">Featured · …</div>
        <div className="h-9 w-32 rounded bg-white/5 mb-3" />
        <div className="h-4 w-48 rounded bg-white/5" />
        <div className="hairline-gold my-5 opacity-40" />
        <div className="h-12 w-20 rounded bg-white/5" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="keynote p-4 rounded-lg animate-pulse">
            <div className="h-7 w-10 rounded bg-white/5" />
            <div className="h-3 w-16 mt-3 rounded bg-white/5" />
          </div>
        ))}
      </div>
    </>
  );
}

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
