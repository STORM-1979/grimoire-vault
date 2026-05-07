"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * Generic styled dropdown matching the rest of the form palette.
 * Replaces native `<select>` whose option list is rendered by the
 * OS / browser (white-on-blue Windows Chrome listbox doesn't read
 * against the emerald-deep / gold theme).  Mirrors CollectionSelect
 * behaviour: click to open, click-outside / Escape to close,
 * Arrow / Enter for keyboard nav, mousedown selection so the
 * outside-click handler doesn't fire first.
 */
export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Optional second-line caption shown muted under the label. */
  hint?: string;
}

export function ThemedSelect<V extends string = string>({
  options,
  value,
  onChange,
  placeholder = "— Не указано —",
}: {
  options: SelectOption<V>[];
  value: V | "";
  onChange: (next: V | "") => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  // The blank "no selection" sentinel lives at index 0 so the user
  // can clear the field via the same Enter / mousedown pipeline.
  // Memoised so its identity is stable across renders; otherwise
  // the two useEffect hooks below would re-arm on every keystroke
  // and lint would (rightfully) complain.
  const opts: SelectOption<V | "">[] = useMemo(
    () => [{ value: "" as V | "", label: placeholder }, ...options],
    [options, placeholder],
  );
  const selected = opts.find((o) => o.value === value) ?? opts[0];

  useEffect(() => {
    if (open) {
      const i = opts.findIndex((o) => o.value === value);
      setActiveIdx(i >= 0 ? i : 0);
    }
  }, [open, value, opts]);

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
        if (opt) { onChange(opt.value as V | ""); setOpen(false); }
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
        <span className={selected.value === "" ? "text-ivory-mute" : "text-ivory"}>
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
            const isSelected = o.value === selected.value;
            return (
              <li
                key={o.value || "__none"}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.value as V | "");
                  setOpen(false);
                }}
                className={
                  "px-3 py-2 cursor-pointer text-[13px] flex flex-col gap-0.5 transition " +
                  (isActive
                    ? "bg-gold/15 text-ivory"
                    : "text-ivory-dim hover:text-ivory") +
                  (o.value === "" ? " italic" : "")
                }
              >
                <div className="flex items-center gap-2">
                  {isSelected ? (
                    <span aria-hidden className="text-gold">•</span>
                  ) : (
                    <span aria-hidden className="w-2" />
                  )}
                  <span>{o.label}</span>
                </div>
                {o.hint && (
                  <div className="ml-4 text-[11px] text-ivory-mute/80">{o.hint}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
