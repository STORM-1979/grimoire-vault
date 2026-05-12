"use client";

import { Icon } from "@/components/icons/Icon";

/**
 * One-click jumps to the platforms the vault talks to from the
 * outside world: the user's own portfolio site, GitHub, Railway,
 * Vercel, Supabase.  Pure external links — no integration, no
 * data fetched.  Lives on the home page between the clock/
 * calendar hero and the categories grid as a kind of "external
 * dock".
 *
 * The portfolio site doesn't exist yet, so its tile renders as a
 * disabled placeholder with a tooltip explaining the situation.
 * Once the user lands a real URL we just plug it into `href`.
 */
interface Link {
  label: string;
  /** null = placeholder, no destination yet. */
  href: string | null;
  /** Short helper line under the label. */
  note: string;
  /** Monogram or symbol drawn in the icon slot.  Using brand
   *  initials keeps us clear of any trademark issues that copying
   *  the actual logos would invite. */
  mark: string;
  /** Tailwind colour class for the monogram, picked to nudge brand
   *  recognition without copying logos verbatim. */
  markClass: string;
}

const LINKS: Link[] = [
  {
    label: "Portfolio",
    href: null,
    note: "сайт ещё не запущен",
    mark: "P",
    markClass: "text-emerald-200",
  },
  {
    label: "GitHub",
    href: "https://github.com/",
    note: "репозитории и issues",
    mark: "G",
    markClass: "text-ivory",
  },
  {
    label: "Railway",
    href: "https://railway.com/dashboard",
    note: "инфраструктура",
    mark: "R",
    markClass: "text-emerald-200",
  },
  {
    label: "Vercel",
    href: "https://vercel.com/storm-1979s-projects",
    note: "деплои фронта",
    mark: "▲",
    markClass: "text-ivory",
  },
  {
    label: "Supabase",
    href: "https://supabase.com/dashboard/org/qxdzseqmrzuvftiofged",
    note: "Postgres · auth · storage",
    mark: "S",
    markClass: "text-gold",
  },
];

export function QuickLinks() {
  return (
    <section className="max-w-[1480px] mx-auto px-10 pt-4 pb-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4">
        Внешние сервисы
      </div>
      <div className="grid grid-cols-5 gap-3">
        {LINKS.map((it) => {
          // Disabled tile when the destination isn't ready yet.
          // Same visual frame, dimmed, no hover affordance, tooltip
          // explains the dead end.
          if (!it.href) {
            return (
              <div
                key={it.label}
                title={it.note}
                aria-disabled="true"
                className="group keynote rounded-xl p-4 flex items-center gap-3 opacity-50 cursor-not-allowed select-none"
              >
                <Monogram mark={it.mark} markClass={it.markClass} />
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[16px] font-medium leading-tight text-ivory truncate">
                    {it.label}
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute/70 mt-1 truncate">
                    {it.note}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <a
              key={it.label}
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group keynote rounded-xl p-4 flex items-center gap-3 hover:border-gold/40 hover:bg-white/[0.04] transition relative"
            >
              <Monogram mark={it.mark} markClass={it.markClass} />
              <div className="flex-1 min-w-0">
                <div className="font-display text-[16px] font-medium leading-tight text-ivory group-hover:text-gold transition truncate">
                  {it.label}
                </div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1 truncate">
                  {it.note}
                </div>
              </div>
              <div className="text-ivory-mute/60 group-hover:text-gold transition flex-shrink-0">
                <Icon name="arrow" size={14} />
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Round monogram badge.  Same dimensions across all five tiles so
 * the row reads as a clean horizontal rhythm.
 */
function Monogram({ mark, markClass }: { mark: string; markClass: string }) {
  return (
    <div className="w-10 h-10 rounded-lg border border-gold/30 bg-emerald-deep/60 flex items-center justify-center flex-shrink-0">
      <span className={`font-display text-[18px] font-medium leading-none ${markClass}`}>
        {mark}
      </span>
    </div>
  );
}
