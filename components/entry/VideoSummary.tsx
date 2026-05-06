"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Displays an extractive thesis summary for a YouTube entry on the
 * detail page.  Lazy: hits POST /api/entries/[id]/summarize on first
 * mount, the route fetches the transcript + runs the summarizer + caches
 * into entry.metadata.summary so subsequent visits are instant.
 *
 * Renders:
 *   • cached theses immediately if `initial` is supplied (pre-saved)
 *   • a loading line while the API call is in flight
 *   • a graceful "no captions" message if the video has no transcript
 *   • nothing at all if the entry isn't a YouTube URL
 */
export function VideoSummary({
  entryId,
  initial,
}: {
  entryId: string;
  initial?: string[];
}) {
  const [theses, setTheses] = useState<string[] | null>(initial && initial.length ? initial : null);
  const [loading, setLoading] = useState(!theses);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (theses) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/entries/${entryId}/summarize`, { method: "POST" });
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? `Не удалось получить тезисы (HTTP ${res.status})`);
          setLoading(false);
          return;
        }
        const data = await res.json() as { summary?: string[] };
        if (cancelled) return;
        setTheses(data.summary ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, theses]);

  if (!loading && !theses?.length && !error) return null;

  return (
    <section className="max-w-[1080px] mx-auto px-10 pt-8 pb-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-3 flex items-center gap-2">
        <Icon name="prompts" size={12} /> Краткое содержание
      </div>
      {loading && (
        <div className="font-mono text-[11px] text-ivory-mute italic">
          Готовлю выжимку — это занимает до минуты при первом открытии…
        </div>
      )}
      {error && !loading && (
        <div className="font-mono text-[11px] text-amber-300/80 flex items-start gap-2">
          <Icon name="x" size={12} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {!loading && theses && theses.length > 0 && (
        <ul className="space-y-2 list-disc pl-6 marker:text-gold">
          {theses.map((t, i) => (
            <li key={i} className="text-[15px] text-ivory leading-relaxed font-light">
              {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
