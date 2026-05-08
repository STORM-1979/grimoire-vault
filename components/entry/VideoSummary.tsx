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
  // Manual-paste escape hatch.  By late 2025 every public transcript
  // proxy (kome.ai, Invidious mirrors, tactiq, savesubs, etc.) gets
  // intermittently blocked by YouTube. When all auto paths fail we
  // give the user a textarea to drop the transcript copied from the
  // YouTube player's "Show transcript" panel — the rest of the
  // pipeline (extractive + translate + LLM polish) doesn't care
  // where the text came from.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  // Attempt counter — bumping it re-runs the auto pipeline.
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    // Already polished and cached on the server — don't re-run anything.
    if (initialSource === "llm" && initial && initial.length) return;

    let cancelled = false;
    (async () => {
      const id = youtubeVideoId(videoUrl);
      if (!id) return;

      // Stage 1a: try browser kome.ai (residential IP, fastest).
      setStage("transcript");
      const browserResult = await fetchTranscriptFromBrowser(id);
      if (cancelled) return;

      let transcript: string | null = null;
      let failReason = "";
      if (browserResult.ok) {
        transcript = browserResult.text;
      } else {
        failReason = browserResult.reason;
        // Stage 1b: fall back to server-side multi-path chain
        // (server kome.ai retry → innertube → mobile → invidious).
        // The server returns extractive theses directly so we'll
        // adopt those if it succeeds.
        try {
          const res = await fetch(`/api/entries/${entryId}/summarize`, { method: "POST" });
          if (cancelled) return;
          if (res.ok) {
            const data = await res.json() as { summary?: string[]; source?: string };
            if (data.summary?.length) {
              setTheses(data.summary);
              setSource(data.source ?? "extractive");
              // Run polish in browser if server gave us something —
              // server might've succeeded via innertube/mobile/invidious,
              // and we don't have the raw transcript locally to polish
              // ourselves, so this round skips the polish step.
              setStage("done");
              return;
            }
          } else {
            const body = await res.json().catch(() => ({}));
            failReason = `${failReason} · сервер: ${body?.error ?? `HTTP ${res.status}`}`;
          }
        } catch (e) {
          failReason = `${failReason} · сервер: ${(e as Error).message}`;
        }
      }

      if (!transcript) {
        setStage("fail");
        setErrorMsg(`Транскрипт недоступен (${failReason || "нет субтитров"})`);
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
  }, [entryId, videoUrl, initial, initialSource, retryNonce]);

  // Run the same extractive + LLM pipeline against a transcript the
  // user pasted manually.  Doesn't go through fetchTranscriptFromBrowser
  // — the transcript is already in hand.
  const runWithManualTranscript = async () => {
    const transcript = manualText.trim();
    if (transcript.length < 200) return;
    setManualBusy(true);
    setErrorMsg(null);
    setStage("extractive");
    try {
      const raw = summarize(transcript, 5);
      let extractive = raw;
      if (raw.length > 0 && !looksRussian(raw[0])) {
        extractive = await translateArrayToRussianBrowser(raw);
      }
      if (extractive.length > 0) {
        setTheses(extractive);
        setSource("extractive");
        void persistSummary(entryId, extractive, "extractive", transcript);
      }
      setStage("polishing");
      const polished = await polishWithLLMBrowser(transcript);
      if (!polished || polished.length < 3) {
        setStage("done");
        if (extractive.length === 0) {
          setStage("fail");
          setErrorMsg("Не удалось выделить тезисы из вставленного текста");
        }
        return;
      }
      let polishedRu = polished;
      if (!looksRussian(polished[0])) {
        polishedRu = await translateArrayToRussianBrowser(polished);
      }
      setTheses(polishedRu);
      setSource("llm");
      setStage("done");
      void persistSummary(entryId, polishedRu, "llm", transcript);
      setManualOpen(false);
    } catch (e) {
      setStage("fail");
      setErrorMsg(`Не удалось обработать вставленный текст: ${(e as Error).message}`);
    } finally {
      setManualBusy(false);
    }
  };

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
        <div className="space-y-3">
          <div className="font-mono text-[11px] text-amber-300/80 flex items-start gap-2">
            <Icon name="x" size={12} className="mt-0.5 flex-shrink-0" />
            <span>{errorMsg ?? "Не удалось получить тезисы"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStage("idle");
                setErrorMsg(null);
                setRetryNonce((n) => n + 1);
              }}
              className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40 transition flex items-center gap-1.5"
            >
              <Icon name="refresh" size={11} /> Повторить попытку
            </button>
            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
            >
              <Icon name="add" size={11} /> Вставить транскрипт вручную
            </button>
          </div>
          {manualOpen && (
            <div className="space-y-2 pt-2">
              <div className="font-mono text-[10px] text-ivory-mute/80 leading-relaxed">
                Открой видео на YouTube → ⋮ под плеером → «Показать расшифровку».
                Скопируй текст (Ctrl+A, Ctrl+C) и вставь сюда.  Pipeline тот же —
                извлечение тезисов, перевод на русский, LLM-полировка.
              </div>
              <textarea
                className="field-textarea min-h-[160px] font-mono text-[12px]"
                placeholder="Вставь транскрипт целиком…"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={runWithManualTranscript}
                  disabled={manualBusy || manualText.trim().length < 200}
                  className="bg-ivory text-emerald-950 px-4 py-2 rounded-full font-mono text-[10px] uppercase tracking-widest hover:bg-emerald-100 disabled:opacity-40 transition flex items-center gap-1.5"
                >
                  <Icon name="check" size={11} /> {manualBusy ? "Обрабатываю…" : "Обработать"}
                </button>
                <span className="font-mono text-[9px] text-ivory-mute/70">
                  минимум 200 символов · сейчас {manualText.trim().length}
                </span>
              </div>
            </div>
          )}
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
