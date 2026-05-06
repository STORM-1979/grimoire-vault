import "server-only";

/**
 * Free, key-less abstractive summarisation via pollinations.ai.
 *
 * Three-pass design:
 *   1. Smart-sample the transcript so a 2-hour video doesn't get
 *      summarised from its first 8 KB only.  We take head + a handful
 *      of middle slices + tail, joined with "[...]" markers so the
 *      model knows it's seeing a sampled excerpt.
 *   2. POST to text.pollinations.ai with the sampled transcript and a
 *      Russian prompt asking for 5–10 thesis bullets covering the
 *      breadth of topics.
 *   3. Parse bullets out of the response.  If the model returned
 *      something we couldn't parse (empty / malformed / too short),
 *      retry once with a slightly trimmed payload — Pollinations
 *      sometimes returns blank when input is near its limit.
 *
 * Free + no key + graceful fallback to extractive output if all
 * attempts fail.
 */

const POLLINATIONS_URL = "https://text.pollinations.ai/";
const REQUEST_TIMEOUT_MS = 50_000;

// Pollinations' `openai-fast` (GPT-OSS-20B) accepts ~32 K context.
// 16 KB of UTF-8 (mostly Cyrillic, ~2 chars per token in Russian) is
// roughly 8 K tokens of input — half the model's window, plenty of
// headroom for the response.
const MAX_INPUT_BYTES = 16 * 1024;
const RETRY_INPUT_BYTES = 10 * 1024;

interface PolishResult {
  bullets: string[];
  attempts: Array<{ ok: boolean; bytesIn: number; bytesOut: number; reason?: string }>;
}

/**
 * Sample a long transcript so the LLM sees content from the whole
 * video, not just the first N kilobytes.  Layout:
 *
 *     [head ~30 %] [...] [middle slice 1] [...] ... [middle slice 4]
 *     [...] [tail ~20 %]
 *
 * For an input ≤ maxBytes the function is a passthrough.
 */
function smartSample(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  const headSize = Math.floor(maxBytes * 0.32);
  const tailSize = Math.floor(maxBytes * 0.18);
  const middleBudget = maxBytes - headSize - tailSize - 80; // separator overhead
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
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "User-Agent": "Mozilla/5.0 (compatible; GrimoireVaultBot/1.0)",
      },
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

export async function polishWithLLM(transcript: string): Promise<string[] | null> {
  if (!transcript?.trim()) return null;
  const isLong = transcript.length > MAX_INPUT_BYTES;
  const attempts: PolishResult["attempts"] = [];

  // Attempt 1 — full sample window.
  const primary = smartSample(transcript, MAX_INPUT_BYTES);
  const prompt1 = buildPrompt(primary, isLong);
  const res1 = await callPollinations(prompt1);
  attempts.push({
    ok: res1.ok,
    bytesIn: prompt1.length,
    bytesOut: res1.text.length,
    reason: res1.ok ? undefined : `HTTP ${res1.status}`,
  });
  if (res1.ok) {
    const bullets = parseBulletResponse(res1.text);
    if (bullets.length >= 3) {
      console.log(JSON.stringify({
        msg: "polish.attempts",
        attempts,
        finalBullets: bullets.length,
      }));
      return bullets;
    }
    attempts[attempts.length - 1].reason = `parsed ${bullets.length} bullets, need ≥ 3`;
    // Log a slice of the raw response so we can see what the model returned.
    console.log(JSON.stringify({
      msg: "polish.bad_response",
      first200: res1.text.slice(0, 200),
      length: res1.text.length,
    }));
  }

  // Attempt 2 — smaller sample, in case the first hit a length wall.
  const trimmed = smartSample(transcript, RETRY_INPUT_BYTES);
  const prompt2 = buildPrompt(trimmed, isLong);
  const res2 = await callPollinations(prompt2);
  attempts.push({
    ok: res2.ok,
    bytesIn: prompt2.length,
    bytesOut: res2.text.length,
    reason: res2.ok ? undefined : `HTTP ${res2.status}`,
  });
  if (res2.ok) {
    const bullets = parseBulletResponse(res2.text);
    if (bullets.length >= 3) {
      console.log(JSON.stringify({
        msg: "polish.attempts",
        attempts,
        finalBullets: bullets.length,
        retried: true,
      }));
      return bullets;
    }
    attempts[attempts.length - 1].reason = `parsed ${bullets.length} bullets, need ≥ 3`;
    console.log(JSON.stringify({
      msg: "polish.bad_response.retry",
      first200: res2.text.slice(0, 200),
      length: res2.text.length,
    }));
  }

  console.log(JSON.stringify({ msg: "polish.attempts", attempts, finalBullets: 0 }));
  return null;
}

/**
 * Strip markdown / bullet prefixes and pick out usable lines.  Permissive
 * about glyphs so a mis-formatted response is still recoverable.
 */
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
