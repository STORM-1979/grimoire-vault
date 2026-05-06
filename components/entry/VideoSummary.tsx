"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

/**
 * Two-stage summary loader for YouTube entries.
 *
 *   stage 1 — POST /api/entries/[id]/summarize
 *     Fast extractive pass.  Returns in 2–4 s on cold cache, instant
 *     on warm cache.  Renders bullets immediately so the user has
 *     content while the LLM is still warming up.
 *
 *   stage 2 — POST /api/entries/[id]/polish
 *     Slow LLM upgrade (Pollinations free endpoint, 30–55 s).  Runs
 *     only when stage 1's response said `source !== "llm"`.  When it
 *     resolves, the bullets seamlessly swap to the polished version
 *     and a small "AI" badge appears.
 *
 * If polish fails / times out, the extractive bullets stay on screen
 * — degrading gracefully rather than hiding content.
 */
export function VideoSummary({
  entryId,
  initial,
  initialSource,
}: {
  entryId: string;
  initial?: string[];
  initialSource?: string;
}) {
  const [theses, setTheses] = useState<string[] | null>(initial && initial.length ? initial : null);
  const [source, setSource] = useState<string>(initialSource ?? "");
  const [loading, setLoading] = useState(!theses);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stage 1 — fast extractive (or cached).
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
        const data = await res.json() as { summary?: string[]; source?: string };
        if (cancelled) return;
        setTheses(data.summary ?? []);
        setSource(data.source ?? "extractive");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, theses]);

  // Stage 2 — request the LLM polish only if we don't already have it.
  useEffect(() => {
    if (loading || !theses || theses.length === 0) return;
    if (source === "llm") return; // Already polished.
    let cancelled = false;
    setPolishing(true);
    (async () => {
      try {
        const res = await fetch(`/api/entries/${entryId}/polish`, { method: "POST" });
        if (cancelled) return;
        if (!res.ok) {
          // Polish failed — keep showing extractive but tell the user
          // an upgrade was attempted and didn't land, so they don't
          // wonder why the "AI" badge never appeared.
          const body = await res.json().catch(() => ({}));
          setPolishError(body?.error ?? "AI-выжимка пока недоступна");
          return;
        }
        const data = await res.json() as { summary?: string[]; source?: string };
        if (cancelled) return;
        if (data.summary?.length) {
          setTheses(data.summary);
          setSource(data.source ?? "llm");
        }
      } catch {
        /* network blip — keep extractive */
      } finally {
        if (!cancelled) setPolishing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entryId, loading, theses, source]);

  if (!loading && !theses?.length && !error) return null;

  return (
    <section className="max-w-[1080px] mx-auto px-10 pt-8 pb-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-3 flex items-center gap-2">
        <Icon name="prompts" size={12} /> Краткое содержание
        {source === "llm" && (
          <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200 text-[9px]">
            AI
          </span>
        )}
        {polishing && (
          <span className="ml-2 normal-case tracking-normal text-ivory-mute font-light">
            · обновляю выжимку через нейросеть…
          </span>
        )}
        {!polishing && polishError && source !== "llm" && (
          <span className="ml-2 normal-case tracking-normal text-amber-300/80 font-light">
            · {polishError}
          </span>
        )}
      </div>
      {loading && (
        <div className="font-mono text-[11px] text-ivory-mute italic">
          Готовлю тезисы по транскрипту…
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
            <li key={`${i}-${t.slice(0, 20)}`} className="text-[15px] text-ivory leading-relaxed font-light">
              {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
