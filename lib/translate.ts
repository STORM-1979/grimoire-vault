import "server-only";

/**
 * Free server-side translation helpers.
 *
 * Two providers, in order:
 *   1. Google Translate's public web endpoint (`translate_a/single`).
 *      Unofficial / key-less, but stable for years and used by every
 *      open-source `google-translate-api` package.  Quality is best-
 *      in-class for short conversational text — the kind we get out of
 *      auto-generated YouTube captions.
 *   2. MyMemory.  Free, key-less, ~5 K words/day for an unauthenticated
 *      caller — plenty for a personal vault.  Quality is decent.
 *
 * The summarize route only needs to translate up to five short thesis
 * sentences (~200 chars each), well under either provider's per-call
 * limit.  We hit Google first, fall through to MyMemory only if Google
 * fails entirely (network error / HTML response / empty body).
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Returns true if the string contains noticeable Cyrillic content. */
export function looksRussian(text: string): boolean {
  if (!text) return false;
  const letters = text.match(/[A-Za-zА-Яа-яЁё]/g);
  if (!letters?.length) return false;
  const cyrillic = text.match(/[А-Яа-яЁё]/g) ?? [];
  return cyrillic.length / letters.length >= 0.3;
}

async function tryGoogleTranslate(text: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const url =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<unknown>;
    // Response shape: [ [ [translated, original, ...], [...], ... ], ...metadata ]
    const segments = (data?.[0] as Array<Array<unknown>>) ?? [];
    const ru = segments.map((seg) => (seg?.[0] as string) ?? "").join("");
    return ru.trim() || null;
  } catch {
    return null;
  }
}

async function tryMyMemory(text: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const url =
      "https://api.mymemory.translated.net/get" +
      `?q=${encodeURIComponent(text)}&langpair=en|ru`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { responseData?: { translatedText?: string } };
    const ru = data?.responseData?.translatedText?.trim();
    return ru && ru.length > 0 ? ru : null;
  } catch {
    return null;
  }
}

/** Translate a single string to Russian.  Returns null if both providers fail. */
export async function translateToRussian(text: string): Promise<string | null> {
  if (!text?.trim()) return null;
  const fromGoogle = await tryGoogleTranslate(text);
  if (fromGoogle) return fromGoogle;
  return await tryMyMemory(text);
}

/**
 * Translate an array of short strings in parallel.  If a particular
 * line fails translation it falls through to the original — better to
 * mix languages than to drop content.
 */
export async function translateArrayToRussian(items: string[]): Promise<string[]> {
  const results = await Promise.all(
    items.map(async (s) => (await translateToRussian(s)) ?? s),
  );
  return results;
}
