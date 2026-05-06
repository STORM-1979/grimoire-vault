"use client";

/**
 * Browser-side abstractive polish via pollinations.ai.
 *
 * Same prompt + smart-sample logic as the server version but runs in
 * the user's tab.  No Vercel timeout limits — the browser is happy to
 * wait 60+ seconds for the model.  Pollinations sets
 * `Access-Control-Allow-Origin: *` so this works without a proxy.
 */

const POLLINATIONS_URL = "https://text.pollinations.ai/";
const REQUEST_TIMEOUT_MS = 70_000;
const MAX_INPUT_BYTES = 16 * 1024;
const RETRY_INPUT_BYTES = 10 * 1024;

function smartSample(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  const headSize = Math.floor(maxBytes * 0.32);
  const tailSize = Math.floor(maxBytes * 0.18);
  const middleBudget = maxBytes - headSize - tailSize - 80;
  const numSlices = 4;
  const sliceSize = Math.floor(middleBudget / numSlices);
  const head = text.slice(0, headSize);
  const tail = text.slice(text.length - tailSize);
  const innerStart = headSize;
  const innerEnd = text.length - tailSize;
  const innerLen = innerEnd - innerStart;
  const stride = Math.floor((innerLen - sliceSize) / Math.max(1, numSlices - 1));
  const middle: string[] = [];
  for (let i = 0; i < numSlices; i++) {
    const off = innerStart + i * stride;
    middle.push(text.slice(off, off + sliceSize));
  }
  return [head, ...middle, tail].join("\n\n[...]\n\n");
}

function buildPrompt(sampled: string, isLong: boolean): string {
  if (isLong) {
    return (
      `Перед тобой расшифровка длинного YouTube-видео. Я взял несколько фрагментов из разных частей видео — они разделены маркерами "[...]". ` +
      `Сделай 8-10 самых важных тезисов на русском, которые отражают ключевые идеи и моменты ВСЕГО видео, а не только начала. ` +
      `Каждый тезис — одно полное самостоятельное предложение, без воды и спойлеров. ` +
      `Каждый тезис начинай с символа "•" и пиши с новой строки. Никакого вступления, заключения или нумерации — только пункты.\n\n` +
      `Транскрипт (фрагменты):\n${sampled}`
    );
  }
  return (
    `Сделай краткое содержание видео из транскрипта. Дай ровно 5 содержательных тезисов на русском. ` +
    `Каждый тезис — одно полное предложение, начинай с символа "•" и пиши с новой строки. ` +
    `Без вступления и заключения, только пункты. Не используй markdown-разметку.\n\n` +
    `Транскрипт:\n${sampled}`
  );
}

async function callPollinations(prompt: string): Promise<{ ok: boolean; text: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(POLLINATIONS_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Accept: "text/plain" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        model: "openai-fast",
      }),
    });
    const text = await res.text();
    return { ok: res.ok, text, status: res.status };
  } catch (e) {
    return { ok: false, text: `error: ${(e as Error).message}`, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function parseBulletResponse(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(?:краткое\s+содержание|итоги|вывод|тезисы|основные)/i.test(l));
  const out: string[] = [];
  for (const l of lines) {
    const m =
      l.match(/^[•\-*–—‣⁃]\s*(.+)$/)
      ?? l.match(/^\d+[.)]\s*(.+)$/)
      ?? l.match(/^[*_]+\s*(.+)$/);
    if (!m) continue;
    let body = m[1].trim();
    body = body
      .replace(/^["«]+|["»]+$/g, "")
      .replace(/^\*+|\*+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (body.length >= 20 && body.length <= 500) out.push(body);
  }
  return out.slice(0, 12);
}

export async function polishWithLLMBrowser(transcript: string): Promise<string[] | null> {
  if (!transcript?.trim()) return null;
  const isLong = transcript.length > MAX_INPUT_BYTES;

  // Attempt 1 — full window.
  const primary = smartSample(transcript, MAX_INPUT_BYTES);
  const r1 = await callPollinations(buildPrompt(primary, isLong));
  if (r1.ok) {
    const bullets = parseBulletResponse(r1.text);
    if (bullets.length >= 3) return bullets;
  }
  // 4xx (rate-limit / bad request) — give up; retrying just doubles consumption.
  if (r1.status === 429 || (r1.status >= 400 && r1.status < 500)) return null;

  // Attempt 2 — smaller payload for transient 5xx / parse misses.
  const trimmed = smartSample(transcript, RETRY_INPUT_BYTES);
  const r2 = await callPollinations(buildPrompt(trimmed, isLong));
  if (r2.ok) {
    const bullets = parseBulletResponse(r2.text);
    if (bullets.length >= 3) return bullets;
  }
  return null;
}
