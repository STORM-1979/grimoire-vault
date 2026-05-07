import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, parseBody, withErrorHandler, HttpError } from "@/lib/api-helpers";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ratelimit";

/**
 * POST /api/suggest-tags
 *
 * Asks Pollinations' free GPT-OSS-20B model to propose 3–5 short
 * tags + a best-fit category for a draft entry given its title +
 * description.  Reuses the user's existing tag vocabulary as a
 * preference list so suggestions stay consistent across captures.
 *
 * Free + key-less + best-effort: any LLM hiccup returns an empty
 * suggestion list and the form just stays as-is.  Rate-limited
 * (10/min/user) so a runaway debounced caller can't trigger a flood.
 */

const schema = z.object({
  title: z.string().trim().min(1).max(280),
  description: z.string().trim().max(2000).optional().default(""),
});

const POLLINATIONS_URL = "https://text.pollinations.ai/";
const REQUEST_TIMEOUT_MS = 12_000;

interface Suggestion {
  category: string;
  tags: string[];
}

export const POST = withErrorHandler(async (req: Request) => {
  const user = await requireUser();
  const limited = await checkRateLimit(user.id, "suggest-tags", RATE_LIMITS.ogExtract);
  if (limited) return limited;
  const { title, description } = await parseBody(req, schema);

  // Pull the user's top-50 most-used tags from a 5-minute in-process
  // cache.  The vocabulary doesn't change between keystrokes so a
  // tight refresh cycle saves a 200 row Postgres round-trip per
  // debounced suggestion call.  Cache key = userId; eviction is
  // pure TTL (no LRU complexity needed at 1-user scale).
  const topTags = await getTopTagsCached(user.id);

  const prompt = buildPrompt(title, description, topTags);
  const result = await callPollinations(prompt);
  const parsed = parseSuggestion(result);
  return NextResponse.json(parsed);
});

const CATEGORY_LIST = [
  "documents", "web", "youtube", "local", "designs", "images",
  "skills", "prompts", "kanban", "ideas", "portfolio", "misc",
] as const;

function buildPrompt(title: string, description: string, topTags: string[]): string {
  return `Ты — помощник для системы личных заметок Grimoire Vault.
Тебе дают черновик записи. Верни ОДИН JSON-объект с полями:
  category — лучший ID из: ${CATEGORY_LIST.join(", ")}
  tags     — массив 3–5 коротких тегов (1–2 слова, без #, lowercase, RU или EN)

Используй существующие теги пользователя из этого списка, когда уместно:
${topTags.slice(0, 30).join(", ") || "(пусто)"}

Если темы записи нет в этом списке — придумай новый тег.

Запись:
Title: ${title}
Description: ${description || "(пусто)"}

Ответь ТОЛЬКО валидным JSON, без markdown-блоков и без комментариев.`;
}

interface PollinationsResult {
  ok: boolean;
  text: string;
  status: number;
}

async function callPollinations(prompt: string): Promise<PollinationsResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(POLLINATIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
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

function parseSuggestion(result: PollinationsResult): Suggestion {
  const empty: Suggestion = { category: "misc", tags: [] };
  if (!result.ok) return empty;
  // Strip markdown fences if the model wrapped output despite the
  // explicit instruction.
  const cleaned = result.text
    .replace(/```json\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const json = JSON.parse(cleaned) as { category?: unknown; tags?: unknown };
    const category = typeof json.category === "string"
      && (CATEGORY_LIST as readonly string[]).includes(json.category)
      ? json.category : "misc";
    const tags = Array.isArray(json.tags)
      ? (json.tags as unknown[])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase().replace(/[#,]/g, ""))
          .filter((t) => t.length >= 2 && t.length <= 30)
          .slice(0, 5)
      : [];
    return { category, tags };
  } catch {
    return empty;
  }
}

export const dynamic = "force-dynamic";

void HttpError;

/* ---------- top-tag cache ---------- */

const TOP_TAG_TTL_MS = 5 * 60 * 1000;
const topTagCache = new Map<string, { tags: string[]; expiresAt: number }>();

async function getTopTagsCached(userId: string): Promise<string[]> {
  const hit = topTagCache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.tags;
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("entries")
    .select("tags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200); // recent 200 — biased towards the user's current vocabulary
  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    for (const t of (r.tags as string[] | null) ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([t]) => t);
  topTagCache.set(userId, { tags: top, expiresAt: Date.now() + TOP_TAG_TTL_MS });
  return top;
}
