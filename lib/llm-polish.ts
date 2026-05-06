import "server-only";

/**
 * Free, key-less abstractive summarisation via pollinations.ai.
 *
 * The extractive summariser picks raw sentences out of the transcript
 * — fine for content but often cuts mid-thought and reads like spoken
 * English (or a literal translation of it).  Pollinations runs an LLM
 * on the transcript and returns a real Russian-language abstract of
 * 5 polished bullet points.
 *
 * Trade-offs:
 *   • Free, no API key, no rate limit beyond Pollinations' fair-use.
 *   • Slow — the only model available to anonymous callers right now
 *     is `openai-fast` (GPT-OSS 20B reasoning) and it takes 30–55 s
 *     for a 2 KB transcript.  We allow up to 50 s before giving up.
 *   • If the response is empty / malformed / late, the caller should
 *     fall back to the extractive output rather than fail the request.
 *
 * Returns string[] of cleaned bullet lines, or null on failure.
 */

const POLLINATIONS_URL = "https://text.pollinations.ai/";
const REQUEST_TIMEOUT_MS = 50_000;

// Keep the prompt + transcript well under any token limit.  GPT-OSS
// 20B has a 4k context — 8 KB of UTF-8 transcript is roughly that.
const MAX_TRANSCRIPT_BYTES = 8 * 1024;

export async function polishWithLLM(transcript: string): Promise<string[] | null> {
  if (!transcript?.trim()) return null;
  const truncated = transcript.length > MAX_TRANSCRIPT_BYTES
    ? transcript.slice(0, MAX_TRANSCRIPT_BYTES)
    : transcript;

  const prompt =
    `Сделай краткое содержание видео из транскрипта. Дай ровно 5 содержательных тезисов на русском языке. ` +
    `Каждый тезис — одно полное предложение, начинай с символа "•" и пиши с новой строки. ` +
    `Без вступления и заключения, только пункты. Не используй markdown-разметку, кавычки в стиле «...», только обычный текст.\n\n` +
    `Транскрипт:\n${truncated}`;

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
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    const cleaned = parseBulletResponse(text);
    return cleaned.length >= 3 ? cleaned : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip markdown / bullet prefixes and pick out usable lines. */
function parseBulletResponse(raw: string): string[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    // Drop empty lines and obvious meta — model occasionally adds
    // "Краткое содержание:" header or numbered list prefixes.
    .filter((l) => l.length > 0 && !/^(?:краткое\s+содержание|итоги|вывод)/i.test(l));
  const out: string[] = [];
  for (const l of lines) {
    // Match a leading bullet glyph or numeric "1." prefix; strip it.
    const m = l.match(/^[•\-*–—]\s*(.+)$/) ?? l.match(/^\d+[.)]\s*(.+)$/);
    if (!m) continue;
    let body = m[1].trim();
    // Drop trailing punctuation noise from broken streaming responses.
    body = body
      .replace(/^["«]+|["»]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (body.length >= 20 && body.length <= 500) out.push(body);
  }
  return out.slice(0, 7);
}
