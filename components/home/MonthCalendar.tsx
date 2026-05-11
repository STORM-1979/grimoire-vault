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
    <div className="keynote rounded-2xl p-6 flex flex-col gap-4 h-full">
      {/* Header — month name + nav controls.  "Сегодня" only shows
          when the user has wandered off the current month, to keep
          the chrome quiet during normal use. */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goPrev}
          title="Предыдущий месяц"
          className="item-actions-btn"
        >
          <Icon name="arrow" size={12} className="rotate-180" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-display text-[22px] font-medium text-ivory leading-none">
            {RU_MONTHS[view.month]}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mt-1.5">
            {view.year}
          </div>
        </div>
        <button
          type="button"
          onClick={goNext}
          title="Следующий месяц"
          className="item-actions-btn"
        >
          <Icon name="arrow" size={12} />
        </button>
      </div>

      {/* Weekday row */}
      <div className="grid grid-cols-7 gap-1">
        {RU_WEEKDAYS.map((wd, i) => (
          <div
            key={wd}
            className={
              "font-mono text-[10px] uppercase tracking-widest text-center py-1 " +
              (i >= 5 ? "text-gold/70" : "text-ivory-mute")
            }
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid.  Empty leading cells keep the weekday columns
          aligned; trailing cells are absent rather than empty so
          the calendar's bottom edge doesn't bloat. */}
      <div className="grid grid-cols-7 gap-1 flex-1 content-start">
        {grid.map((d, i) => {
          if (d === null) {
            return <div key={`empty-${i}`} className="aspect-square" />;
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
                "aspect-square rounded-lg flex items-center justify-center font-display text-[15px] transition relative " +
                (t
                  ? "bg-gold text-emerald-deep font-medium shadow-md"
                  : s
                  ? "border border-gold/60 text-gold"
                  : weekendCol
                  ? "text-gold/70 hover:bg-white/[0.04] hover:text-gold"
                  : "text-ivory hover:bg-white/[0.04]")
              }
              aria-label={`${d} ${RU_MONTHS[view.month]} ${view.year}${t ? ", сегодня" : ""}`}
            >
              {d}
              {t && (
                // Tiny dot under today's number when it's the
                // selected one too — confirms "yes, this is the
                // current date even though we styled it as the
                // primary highlight".  Subtle.
                <span
                  aria-hidden
                  className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-deep/60"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Footer — "Сегодня" reset (only when not already there) */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
          {today.toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
        {(view.year !== today.getFullYear() || view.month !== today.getMonth()) && (
          <button
            type="button"
            onClick={goToday}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
          >
            <Icon name="refresh" size={11} /> Сегодня
          </button>
        )}
      </div>
    </div>
  );
}
