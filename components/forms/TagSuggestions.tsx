"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";

interface Suggestion {
  category: string;
  tags: string[];
}

/**
 * AI-powered tag picker shown under the Tags field.  Watches title +
 * description for changes; once both have something substantial, it
 * debounces 1.2 s and asks the server for suggestions via
 * /api/suggest-tags.  Click any tag chip to merge it into the form.
 *
 * Best-effort by design — silent on failure, doesn't block submit.
 */
export function TagSuggestions({
  title,
  description,
  currentTags,
  onAdd,
}: {
  title: string;
  description: string;
  currentTags: string[];
  onAdd: (tag: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>("");

  useEffect(() => {
    const t = title.trim();
    const d = description.trim();
    if (t.length < 5 || (t.length + d.length) < 15) {
      setSuggestions([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const queryKey = `${t}|${d}`;
    if (lastQueryRef.current === queryKey) return;
    timer.current = setTimeout(async () => {
      lastQueryRef.current = queryKey;
      setLoading(true);
      try {
        const r = await fetch("/api/suggest-tags", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: t, description: d }),
        });
        if (!r.ok) {
          setSuggestions([]);
          return;
        }
        const data = (await r.json()) as Suggestion;
        setSuggestions(data.tags ?? []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [title, description]);

  // Hide tags the user already has.
  const fresh = suggestions.filter(
    (t) => !currentTags.map((x) => x.toLowerCase()).includes(t.toLowerCase()),
  );

  if (!loading && fresh.length === 0) return null;

  return (
    <div className="mt-2 -mb-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute/80 mb-1.5 flex items-center gap-1.5">
        ✨ AI предлагает{loading && fresh.length === 0 ? "…" : ""}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {fresh.map((tag) => {
          const wasAccepted = accepted.has(tag);
          return (
            <button
              key={tag}
              type="button"
              disabled={wasAccepted}
              onClick={() => {
                onAdd(tag);
                setAccepted((prev) => new Set(prev).add(tag));
              }}
              className={
                "font-mono text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full transition flex items-center gap-1 " +
                (wasAccepted
                  ? "border border-emerald-300/30 text-emerald-300/50 cursor-not-allowed"
                  : "border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06]")
              }
            >
              {wasAccepted ? <Icon name="check" size={10} /> : <Icon name="add" size={10} />} {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
