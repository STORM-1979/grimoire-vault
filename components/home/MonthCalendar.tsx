"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

// Week starts on Monday — the Russian/European convention.  Sunday
// sits at index 6 so getDay() (0 = Sun) maps to (day + 6) % 7.
const RU_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/**
 * Interactive month-view calendar in the site's emerald / gold
 * palette.  Today's date is highlighted with a filled gold dot;
 * the selected day (if different from today) gets a thin gold
 * ring.  Prev / next month buttons + a "Сегодня" reset.
 *
 * No external date library — the few date primitives we need
 * (start of month, days in month, weekday of first day) fit in a
 * handful of `new Date()` calls.  Calendar dates are pure local
 * time, no timezone gymnastics needed for a "what's today"
 * surface.
 *
 * Click on a day = select it (visual only for now).  Hooking this
 * up to filter /today by that date is a natural next step but not
 * what this commit ships.
 */
export function MonthCalendar() {
  const today = useMemo(() => new Date(), []);
  // View state: which month is being browsed.  Defaults to today's
  // month; the "Сегодня" button snaps back.
  const [view, setView] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  // Selected day (within `view`).  Defaults to today on first
  // mount; cleared on month change so we don't carry a phantom
  // selection across months.
  const [selected, setSelected] = useState<{ y: number; m: number; d: number } | null>({
    y: today.getFullYear(),
    m: today.getMonth(),
    d: today.getDate(),
  });

  // Build the grid: empty cells before the first weekday + day
  // numbers 1..N.  We don't fill trailing empty cells — the
  // bottom row just ends short, which reads cleaner than greyed-
  // out spillover days.
  const grid = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const last = new Date(view.year, view.month + 1, 0);
    const startWeekday = (first.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = last.getDate();
    const cells: Array<number | null> = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [view]);

  const goPrev = () => {
    setView((v) => {
      const m = v.month - 1;
      if (m < 0) return { year: v.year - 1, month: 11 };
      return { year: v.year, month: m };
    });
  };
  const goNext = () => {
    setView((v) => {
      const m = v.month + 1;
      if (m > 11) return { year: v.year + 1, month: 0 };
      return { year: v.year, month: m };
    });
  };
  const goToday = () => {
    setView({ year: today.getFullYear(), month: today.getMonth() });
    setSelected({ y: today.getFullYear(), m: today.getMonth(), d: today.getDate() });
  };

  const isToday = (d: number) =>
    view.year === today.getFullYear()
    && view.month === today.getMonth()
    && d === today.getDate();

  const isSelected = (d: number) =>
    selected != null
    && selected.y === view.year
    && selected.m === view.month
    && selected.d === d;

  return (
    <div className="keynote rounded-2xl p-4 flex flex-col gap-3">
      {/* Header — month name + nav controls.  "Сегодня" only shows
          when the user has wandered off the current month, to keep
          the chrome quiet during normal use. */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrev}
          title="Предыдущий месяц"
          className="item-actions-btn"
        >
          <Icon name="arrow" size={11} className="rotate-180" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-display text-[17px] font-medium text-ivory leading-none">
            {RU_MONTHS[view.month]}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-gold mt-1">
            {view.year}
          </div>
        </div>
        <button
          type="button"
          onClick={goNext}
          title="Следующий месяц"
          className="item-actions-btn"
        >
          <Icon name="arrow" size={11} />
        </button>
      </div>

      {/* Weekday row — sits flush against the grid below so the
          column lines visually continue through the header.  Uses
          the same gap-px-on-tinted-parent pattern as the days
          grid for consistency. */}
      <div className="rounded-t-lg overflow-hidden bg-gold/15 grid grid-cols-7 gap-px">
        {RU_WEEKDAYS.map((wd, i) => (
          <div
            key={wd}
            className={
              "bg-emerald-deep/95 font-mono text-[10px] uppercase tracking-widest text-center py-2 " +
              (i >= 5 ? "text-gold" : "text-ivory-mute")
            }
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid with visible hairlines.  We render a 7-col,
          N-row sub-grid wrapped in a gold-tinted background; each
          cell sits at gap-px so the parent's bg shows through as
          thin gold rules between cells.  Same pattern the /
          categories page uses for the room-grid.  Trailing empties
          fill out the bottom row so the last week never looks
          truncated. */}
      <div className="rounded-b-lg overflow-hidden bg-gold/15 grid grid-cols-7 gap-px">
        {(() => {
          // Pad to a full 7-wide bottom row so the grid bottom edge
          // is uniform.  Without this, months that end on a Wednesday
          // (etc.) leave a ragged half-row that breaks the rectangle.
          const padded = [...grid];
          while (padded.length % 7 !== 0) padded.push(null);
          return padded.map((d, i) => {
            if (d === null) {
              return <div key={`empty-${i}`} className="bg-emerald-deep/95 h-11" />;
            }
            const t = isToday(d);
            const s = isSelected(d);
            const weekendCol = i % 7 >= 5;
            return (
              <button
                key={`d-${d}`}
                type="button"
                onClick={() => setSelected({ y: view.year, m: view.month, d })}
                className={
                  "h-11 flex items-center justify-center font-display text-[15px] transition relative " +
                  (t
                    ? "bg-gold text-emerald-deep font-semibold shadow-inner"
                    : s
                    ? "bg-emerald-deep/95 ring-1 ring-inset ring-gold/60 text-gold"
                    : weekendCol
                    ? "bg-emerald-deep/95 text-gold/70 hover:bg-white/[0.05] hover:text-gold"
                    : "bg-emerald-deep/95 text-ivory hover:bg-white/[0.05]")
                }
                aria-label={`${d} ${RU_MONTHS[view.month]} ${view.year}${t ? ", сегодня" : ""}`}
              >
                {d}
              </button>
            );
          });
        })()}
      </div>

      {/* Current date — prominent strip under the grid.  This is
          the calendar's "anchor reading" so the user always knows
          what day it actually is, regardless of which month they
          may have wandered into via prev/next. */}
      <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/10">
        <div className="leading-tight">
          <div className="font-display text-[18px] font-medium text-gold capitalize leading-tight">
            {today.toLocaleDateString("ru-RU", { weekday: "long" })}
          </div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-ivory-mute mt-1">
            {today.toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
        </div>
        {(view.year !== today.getFullYear() || view.month !== today.getMonth()) && (
          <button
            type="button"
            onClick={goToday}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5 flex-shrink-0"
          >
            <Icon name="refresh" size={11} /> Сегодня
          </button>
        )}
      </div>
    </div>
  );
}
