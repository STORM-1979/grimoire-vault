"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Available sort modes for the category list.
 *
 *   - newest   created_at DESC (default — matches API order)
 *   - oldest   created_at ASC
 *   - title    title A→Я
 *   - titleZ   title Я→A
 *   - tags     first-tag alphabetical, untagged entries last;
 *              ties break on created_at DESC
 */
export type SortMode = "newest" | "oldest" | "title" | "titleZ" | "tags";

const LABELS: Record<SortMode, string> = {
  newest: "Новые",
  oldest: "Старые",
  title: "А–Я",
  titleZ: "Я–А",
  tags: "По тегам",
};

const ORDER: SortMode[] = ["newest", "oldest", "title", "titleZ", "tags"];

/**
 * Pill-style dropdown matching the rest of the category header.
 * Mirrors CollectionSelect interaction (click to toggle, click-outside
 * + Escape to close, Arrow / Enter keyboard nav).
 */
export function SortControl({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (next: SortMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (open) {
      const i = ORDER.indexOf(value);
      setActiveIdx(i >= 0 ? i : 0);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(ORDER.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const opt = ORDER[activeIdx];
        if (opt) { onChange(opt); setOpen(false); }
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, activeIdx, onChange]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/15 bg-emerald-deep/40 hover:border-gold/60 hover:bg-emerald-deep/60 transition text-[11px] font-mono uppercase tracking-widest text-ivory-dim hover:text-ivory cursor-pointer"
        title="Сортировка"
      >
        <Icon name="sort" size={12} />
        <span>{LABELS[value]}</span>
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          className={"flex-shrink-0 text-ivory-mute/80 transition-transform " + (open ? "rotate-180" : "")}
        >
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute right-0 mt-1 z-50 min-w-[160px] rounded-lg border border-gold/40 bg-emerald-deep shadow-2xl backdrop-blur-sm py-1"
        >
          {ORDER.map((mode, i) => {
            const isActive = i === activeIdx;
            const isSelected = mode === value;
            return (
              <li
                key={mode}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(mode);
                  setOpen(false);
                }}
                className={
                  "px-3 py-2 cursor-pointer text-[12.5px] flex items-center gap-2 transition " +
                  (isActive
                    ? "bg-gold/15 text-ivory"
                    : "text-ivory-dim hover:text-ivory")
                }
              >
                {isSelected ? (
                  <span aria-hidden className="text-gold">•</span>
                ) : (
                  <span aria-hidden className="w-2" />
                )}
                <span>{LABELS[mode]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
