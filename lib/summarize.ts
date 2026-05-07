/**
 * Extractive video-summary helper.
 *
 * Picks 3–5 thesis sentences out of a transcript or long description
 * using a deliberately simple algorithm — no LLM, no API key, no
 * external service.  Quality won't match a Claude rewrite, but the
 * theses are usable and runtime is "instant".
 *
 * Algorithm (TextRank-light):
 *   1. Split source into sentences.  Auto-generated YouTube subtitles
 *      lack punctuation, so we also split on long pauses (line breaks
 *      between caption segments) and on conjunctive words.
 *   2. Tokenize each sentence; drop stopwords + punctuation; lowercase.
 *   3. Score each sentence by sum of inverse-document-frequency of its
 *      remaining tokens (rare words mean more). Add a small position
 *      bonus to the first 25 % of the source — intros usually contain
 *      the headline thesis on YouTube.
 *   4. Take the top-N by score, then re-sort by original position so
 *      the bullets read in narrative order.
 *
 * The stopword lists are deliberately small — covering Russian + English
 * function words.  A misspelt or rare word being treated as content is
 * fine; we'd rather over-include than over-exclude.
 */

const STOPWORDS_EN = new Set([
  "a","an","the","and","or","but","if","then","else","while","for","to","of",
  "in","on","at","by","with","from","as","is","are","was","were","be","been",
  "being","have","has","had","do","does","did","this","that","these","those",
  "it","its","i","you","he","she","we","they","them","my","your","our","their",
  "his","her","us","me","so","not","no","yes","just","very","more","most",
  "much","any","all","some","every","each","other","than","into","over","out",
  "up","down","about","also","because","what","when","where","why","how","who",
  "whom","which","there","here","can","could","should","would","may","might",
  "will","shall","one","two","three","like","get","got","go","going","gonna",
  "wanna","im","youre","theyre","were","weve","ive","youve","theyve",
  "youll","ill","theyll","dont","doesnt","didnt","cant","wont","ours","yours",
  "ok","okay","right","really","actually","basically","literally","kind","sort",
  "thing","stuff","make","made","make","want","need","know","think",
]);

const STOPWORDS_RU = new Set([
  "и","в","во","не","что","он","на","я","с","со","как","а","то","все","она",
  "так","его","но","да","ты","к","у","же","вы","за","бы","по","только","ее",
  "мне","было","вот","от","меня","еще","нет","о","из","ему","теперь","когда",
  "даже","ну","вдруг","ли","если","уже","или","ни","быть","был","него","до",
  "вас","нибудь","опять","уж","вам","ведь","там","потом","себя","ничего",
  "ей","может","они","тут","где","есть","надо","ней","для","мы","тебя","их",
  "чем","была","сам","чтоб","без","будто","человек","чего","раз","тоже","себе",
  "под","будет","ж","тогда","кто","этот","того","потому","этого","какой",
  "совсем","ним","здесь","этом","один","почти","мой","тем","чтобы","нее",
  "сейчас","были","куда","зачем","всех","никогда","можно","при","наконец",
  "два","об","другой","хоть","после","над","больше","тот","через","эти",
  "нас","про","всего","них","какая","много","разве","три","эту","моя","впрочем",
  "хорошо","свою","этой","перед","иногда","лучше","чуть","том","нельзя",
  "такой","им","более","всегда","конечно","всю","между","это","эта","эти",
]);

/** Tokenize source into best-effort sentences. */
function splitSentences(text: string): string[] {
  // Treat newlines as soft separators for caption segments without
  // punctuation. Then split on . ! ? followed by space + capital, plus
  // long-pause em-dashes.
  const norm = text
    .replace(/\[(?:music|applause|laughter|♪♪♪|музыка|аплодисменты)\]/gi, " ")
    .replace(/[♪♫]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const rough = norm.split(/(?<=[.!?])\s+(?=[A-Za-zА-Яа-яЁё])|\s—\s|\s–\s/);
  const out: string[] = [];
  for (const s of rough) {
    const t = s.trim();
    // Drop fragments shorter than 25 chars (filler) or longer than 400
    // (run-on, probably bad split). 25 chars catches ~5 words minimum.
    if (t.length >= 25 && t.length <= 400) out.push(t);
  }
  // Punctuation-free fallback: YouTube auto-generated subtitles arrive
  // as one giant unpunctuated stream.  When the regex split yields
  // less than three usable fragments we fall back to chunking by ~110
  // chars on word boundaries — that reads roughly like sentences and
  // gives the scorer something to rank.
  if (out.length < 3) {
    const words = norm.split(/\s+/);
    const chunks: string[] = [];
    let cur: string[] = [];
    let curLen = 0;
    for (const w of words) {
      cur.push(w);
      curLen += w.length + 1;
      if (curLen >= 110) {
        const c = cur.join(" ").trim();
        if (c.length >= 25) chunks.push(c);
        cur = [];
        curLen = 0;
      }
    }
    if (cur.length) {
      const c = cur.join(" ").trim();
      if (c.length >= 25) chunks.push(c);
    }
    if (chunks.length >= out.length) return chunks;
  }
  return out;
}

/** Lowercase + strip punctuation + remove stopwords. Returns a multiset. */
function tokenize(s: string): string[] {
  const stop = new Set([...STOPWORDS_EN, ...STOPWORDS_RU]);
  return s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
}

/**
 * Score each sentence by inverse-document-frequency of its tokens, with
 * a small position bonus to the head of the source.  Returns an array
 * of `{ sentence, position, score }` ready to be sorted.
 */
function scoreSentences(sentences: string[]): Array<{ s: string; pos: number; score: number }> {
  // Count document frequency of each token across sentences.
  const df = new Map<string, number>();
  const sentTokens: string[][] = sentences.map((s) => {
    const toks = tokenize(s);
    const seen = new Set(toks);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
    return toks;
  });
  const n = sentences.length || 1;
  const headCutoff = Math.max(2, Math.floor(n * 0.25));

  return sentences.map((s, i) => {
    const toks = sentTokens[i];
    if (toks.length === 0) return { s, pos: i, score: 0 };
    let raw = 0;
    for (const t of toks) {
      const d = df.get(t) ?? 1;
      raw += Math.log((n + 1) / d);
    }
    // Normalise by sqrt of length so long sentences don't always win.
    const norm = raw / Math.sqrt(toks.length);
    const positionBonus = i < headCutoff ? 0.2 : 0;
    return { s, pos: i, score: norm + positionBonus };
  });
}

/**
 * Produce up to `count` thesis sentences from any text source —
 * transcript, description, transcript+description concatenation, etc.
 * Returns the sentences in their original chronological order.
 */
export function summarize(text: string, count = 5): string[] {
  if (!text || !text.trim()) return [];
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];
  if (sentences.length <= count) return sentences;
  const scored = scoreSentences(sentences);
  // Pick top-N by score, then sort back by original position.
  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.s.trim().replace(/\s+/g, " "));
  return top;
}
