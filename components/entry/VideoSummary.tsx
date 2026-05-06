"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { fetchTranscriptFromBrowser, youtubeVideoId } from "@/lib/transcript-client";
import { translateArrayToRussianBrowser, looksRussian } from "@/lib/translate-client";
import { polishWithLLMBrowser } from "@/lib/llm-polish-client";
import { summarize } from "@/lib/summarize";

/**
 * Browser-side video summary pipeline.
 *
 * Vercel's egress IPs got rate-limited on every transcript service we
 * tried (kome.ai, public Invidious mirrors, YouTube directly).  The
 * user's residential IP doesn't have those problems, so we run the
 * whole pipeline here and only call the server to persist the final
 * result.
 *
 * Stages:
 *   1. fetchTranscriptFromBrowser → kome.ai with browser CORS
 *      (CORS is explicitly allowed for grimoire-vault.vercel.app).
 *   2. summarize() → extractive cut, instant.
 *   3. translateArrayToRussianBrowser → Google Translate gtx for
 *      English / non-Russian transcripts.
 *   4. setTheses() → user sees content within ~3 s.
 *   5. polishWithLLMBrowser → Pollinations openai-fast (30–55 s)
 *      replaces extractive with a real abstractive summary.
 *   6. POST /api/entries/[id]/summary-save → merge final summary
 *      into entry.metadata so subsequent visits hit the cache.
 *
 * If transcript fetch fails entirely (kome.ai blocked even from
 * residential, video has no captions, etc.), we show a graceful
 * "Транскрипт недоступен" message instead of bullets.
 */
export function VideoSummary({
  entryId,
  videoUrl,
  initial,
  initialSource,
}: {
  entryId: string;
  videoUrl: string;
  initial?: string[];
  initialSource?: string;
}) {
  const [theses, setTheses] = useState<string[] | null>(initial && initial.length ? initial : null);
  const [source, setSource] = useState<string>(initialSource ?? "");
  const [stage, setStage] = useState<"idle" | "transcript" | "extractive" | "polishing" | "done" | "fail">(
    initial && initial.length ? "done" : "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Already polished and cached on the server — don't re-run anything.
    if (initialSource === "llm" && initial && initial.length) return;

    let cancelled = false;
    (async () => {
      const id = youtubeVideoId(videoUrl);
      if (!id) return;

      // Stage 1: pull transcript in the user's browser.
      setStage("transcript");
      const transcript = await fetchTranscriptFromBrowser(id);
      if (cancelled) return;
      if (!transcript) {
        setStage("fail");
        setErrorMsg("Транскрипт недоступен (у видео нет субтитров либо kome.ai сейчас не отвечает)");
        return;
      }

      // Stage 2 + 3: extractive + translate (instant).
      setStage("extractive");
      const raw = summarize(transcript, 5);
      let extractive = raw;
      if (raw.length > 0 && !looksRussian(raw[0])) {
        extractive = await translateArrayToRussianBrowser(raw);
      }
      if (cancelled) return;
      if (extractive.length > 0) {
        setTheses(extractive);
        setSource("extractive");
        // Persist extractive so the user has something cached even if
        // the polish step fails or the tab is closed mid-LLM call.
        void persistSummary(entryId, extractive, "extractive", transcript);
      }

      // Stage 4: LLM polish — slow, browser does it without Vercel timeout.
      setStage("polishing");
      const polished = await polishWithLLMBrowser(transcript);
      if (cancelled) return;
      if (!polished || polished.length < 3) {
        setStage("done");
        if (extractive.length === 0) {
          setStage("fail");
          setErrorMsg("Не удалось выделить тезисы из транскрипта");
        }
        return;
      }
      let polishedRu = polished;
      if (!looksRussian(polished[0])) {
        polishedRu = await translateArrayToRussianBrowser(polished);
      }
      if (cancelled) return;
      setTheses(polishedRu);
      setSource("llm");
      setStage("done");
      void persistSummary(entryId, polishedRu, "llm", transcript);
    })();

    return () => { cancelled = true; };
  }, [entryId, videoUrl, initial, initialSource]);

  if (stage === "idle" && !theses?.length) return null;

  const stageLabel =
    stage === "transcript" ? "Тяну транскрипт из YouTube…"
    : stage === "extractive" ? "Готовлю быструю выжимку…"
    : stage === "polishing" ? "Обновляю выжимку через нейросеть (≈30–60 с)…"
    : null;

  return (
    <section className="max-w-[1080px] mx-auto px-10 pt-8 pb-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-3 flex items-center gap-2 flex-wrap">
        <Icon name="prompts" size={12} /> Краткое содержание
        {source === "llm" && (
          <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200 text-[9px]">
            AI
          </span>
        )}
        {stageLabel && (
          <span className="ml-2 normal-case tracking-normal text-ivory-mute font-light">
            · {stageLabel}
          </span>
        )}
      </div>
      {stage === "fail" && (
        <div className="font-mono text-[11px] text-amber-300/80 flex items-start gap-2">
          <Icon name="x" size={12} className="mt-0.5 flex-shrink-0" />
          <span>{errorMsg ?? "Не удалось получить тезисы"}</span>
        </div>
      )}
      {theses && theses.length > 0 && (
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

async function persistSummary(
  entryId: string,
  summary: string[],
  source: "extractive" | "llm",
  transcript: string,
): Promise<void> {
  try {
    await fetch(`/api/entries/${entryId}/summary-save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary, source, transcript }),
    });
  } catch {
    /* save is best-effort; user already has the summary on screen */
  }
}
