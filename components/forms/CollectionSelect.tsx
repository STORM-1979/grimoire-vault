"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EntryCollection } from "@/lib/types";

/**
 * Themed dropdown for picking a collection.  Replaces the native
 * `<select>` whose option list is rendered by the OS / browser
 * (white-on-blue Windows Chrome listbox doesn't read against the
 * site's emerald-deep / gold palette).
 *
 * Behaviour:
 *   • Click the trigger to open / close.
 *   • Click outside or press Escape to close.
 *   • Enter / arrow keys scroll through options when open.
 *   • Selecting "— Без коллекции —" maps to value = null.
 */
export function CollectionSelect({
  collections,
  value,
  onChange,
}: {
  collections: EntryCollection[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  // Build the option list with the "no collection" sentinel first,
  // then walk the parent → children tree depth-first so children
  // appear right under their parent with a visual indent.
  // Memoised so effect deps below don't churn on every render.
  type Opt = { id: string | null; label: string; depth: number };
  const opts: Opt[] = useMemo(() => {
    const childrenByParent = new Map<string | null, EntryCollection[]>();
    for (const c of collections) {
      const key = c.parentId ?? null;
      const arr = childrenByParent.get(key) ?? [];
      arr.push(c);
      childrenByParent.set(key, arr);
    }
    const sort = (a: EntryCollection, b: EntryCollection) =>
      a.position - b.position || a.name.localeCompare(b.name);
    for (const arr of childrenByParent.values()) arr.sort(sort);

    const out: Opt[] = [{ id: null, label: "— Без коллекции —", depth: 0 }];
    const visit = (parentId: string | null, depth: number) => {
      for (const c of childrenByParent.get(parentId) ?? []) {
        out.push({ id: c.id, label: c.name, depth });
        visit(c.id, depth + 1);
      }
    };
    visit(null, 0);
    return out;
  }, [collections]);
  const selected = opts.find((o) => o.id === value) ?? opts[0];

  // Track active highlight in sync with the current value when reopened.
  useEffect(() => {
    if (open) {
      const i = opts.findIndex((o) => o.id === value);
      setActiveIdx(i >= 0 ? i : 0);
    }
  }, [open, value, opts]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(opts.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const opt = opts[activeIdx];
        if (opt) { onChange(opt.id); setOpen(false); }
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, activeIdx, opts, onChange]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        className="field-input w-full text-left flex items-center justify-between gap-2 cursor-pointer hover:border-gold/60 transition"
      >
        <span className={selected.id === null ? "text-ivory-mute" : "text-ivory"}>
          {selected.label}
        </span>
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          className={"flex-shrink-0 text-ivory-mute transition-transform " + (open ? "rotate-180" : "")}
        >
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute left-0 right-0 mt-1 z-50 max-h-64 overflow-y-auto rounded-lg border border-gold/40 bg-emerald-deep shadow-2xl backdrop-blur-sm py-1"
        >
          {opts.map((o, i) => {
            const isActive = i === activeIdx;
            const isSelected = o.id === selected.id;
            return (
              <li
                key={o.id ?? "__none"}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  // mousedown so the outside-click handler doesn't fire first.
                  e.preventDefault();
                  onChange(o.id);
                  setOpen(false);
                }}
                style={{ paddingLeft: `${0.75 + o.depth * 1.25}rem` }}
                className={
                  "py-2 pr-3 cursor-pointer text-[13px] flex items-center gap-2 transition " +
                  (isActive
                    ? "bg-gold/15 text-ivory"
                    : "text-ivory-dim hover:text-ivory") +
                  (o.id === null ? " italic" : "")
                }
              >
                {o.depth > 0 && (
                  <span aria-hidden className="text-ivory-mute/60">↳</span>
                )}
                {isSelected ? (
                  <span aria-hidden className="text-gold">•</span>
                ) : (
                  <span aria-hidden className="w-2" />
                )}
                <span>{o.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
