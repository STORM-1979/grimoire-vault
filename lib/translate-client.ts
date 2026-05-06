"use client";

/**
 * Browser-side translation.  Uses Google Translate's public web
 * endpoint (`translate_a/single`) — unofficial / key-less but stable
 * for years and CORS-friendly.  Lets the client polish English /
 * other-language theses into Russian without round-tripping through
 * Vercel.
 */

export function looksRussian(text: string): boolean {
  if (!text) return false;
  const letters = text.match(/[A-Za-zА-Яа-яЁё]/g);
  if (!letters?.length) return false;
  const cyrillic = text.match(/[А-Яа-яЁё]/g) ?? [];
  return cyrillic.length / letters.length >= 0.3;
}

async function tryGoogleTranslateBrowser(text: string): Promise<string | null> {
  if (!text?.trim()) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const url =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<unknown>;
    const segments = (data?.[0] as Array<Array<unknown>>) ?? [];
    const ru = segments.map((seg) => (seg?.[0] as string) ?? "").join("");
    return ru.trim() || null;
  } catch {
    return null;
  }
}

/** Translate every line in parallel; lines that fail keep their original. */
export async function translateArrayToRussianBrowser(items: string[]): Promise<string[]> {
  const results = await Promise.all(
    items.map(async (s) => (await tryGoogleTranslateBrowser(s)) ?? s),
  );
  return results;
}
