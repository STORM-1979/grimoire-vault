/**
 * grammY-based Telegram bot.
 *
 * Used in two contexts:
 *   - production webhook  → app/api/telegram/route.ts wraps this with `webhookCallback`
 *   - dev long-polling    → scripts/telegram-poll.mjs calls bot.start()
 *
 * Both paths share the same handlers, declared once below.
 */
import "server-only";
import { Bot, type Context, GrammyError } from "grammy";
import {
  attachChatId,
  findUserByChatId,
  findUserByLinkCode,
  unlinkSession,
} from "@/lib/data/telegram";
import { createServiceClient } from "@/lib/supabase/server";
import { extractMetadata } from "@/lib/og";
import { computeContentHash } from "@/lib/dedup";
import { getCategory } from "@/lib/categories";
import { pushToUser } from "@/lib/push";
import type { CategoryId } from "@/lib/types";

let _bot: Bot | null = null;

const HELP_TEXT = `📚 *Grimoire Vault — your second brain*

Команды:
/start — заново показать это сообщение
/link <код> — привязать аккаунт (код возьми в Settings → Telegram)
/unlink — отключить
/help — справка

Когда привязан — просто пересылай мне ссылки, фото, голосовые и заметки.
Я раскладываю по разделам базы автоматически.`;

const NOT_LINKED_TEXT = `Сначала привяжи свой аккаунт.

1. Открой /settings в Vault на сайте
2. Нажми "Issue Telegram link code"
3. Пришли сюда: \`/link 482-913\` (вместо примера — твой код)`;

function isYouTubeUrl(text: string): string | null {
  const m = text.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function isUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(text.trim());
}

async function ensureUser(ctx: Context): Promise<{ userId: string; firstName?: string } | null> {
  const chatId = ctx.chat?.id;
  if (!chatId) return null;
  const session = await findUserByChatId(chatId);
  if (!session) return null;
  return { userId: session.userId };
}

/**
 * Resilient reply — never throws.
 * Telegram API can return 400 (chat_not_found, deleted account) or 403
 * (bot blocked by user). We log and continue so the rest of the handler
 * (DB writes, etc.) still completes.
 */
async function safeReply(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
): Promise<void> {
  try {
    await ctx.reply(text, extra);
  } catch (e) {
    const desc = (e as { description?: string })?.description ?? String(e);
    console.warn(`[bot] reply failed (chat=${ctx.chat?.id}): ${desc}`);
  }
}

/* ---- Insert helpers (use service-role to bypass RLS, scoped via user_id) ---- */

interface EntryRow {
  user_id: string;
  category_id: string;
  title: string;
  description?: string | null;
  url?: string | null;
  thumb_url?: string | null;
  duration?: string | null;
  tags?: string[];
  imported_via: string;
  metadata?: Record<string, unknown>;
  content_hash?: string | null;
}

interface InsertResult {
  /** Newly-created row id, or null if the dup branch was taken / fatal error. */
  id?: string;
  /** Set when the unique index found a pre-existing entry. */
  duplicate?: { id: string; categoryId: string; title: string };
}

async function createEntryViaBot(row: EntryRow): Promise<InsertResult | null> {
  // Mirror the API path's behaviour: derive a content_hash unless the
  // caller supplied one.  Lets the bot pick up the same dedup the web
  // form gets — pasting the same link twice surfaces a "уже сохранено"
  // reply rather than silently failing.
  if (row.content_hash == null) {
    const h = computeContentHash({ url: row.url ?? null, title: row.title });
    if (h) row.content_hash = h;
  }
  const svc = createServiceClient();
  const { data, error } = await svc.from("entries").insert(row).select("id").single();
  if (!error) {
    // Fire-and-forget: notify every subscribed device that something
    // landed.  The push helper is no-op if VAPID env is unset.  We
    // intentionally don't await — a slow push provider shouldn't make
    // the bot's "✓ saved" reply lag.
    const cat = getCategory(row.category_id as CategoryId);
    void pushToUser(row.user_id, {
      title: cat ? `📥 ${cat.en}` : "Grimoire Vault",
      body: row.title,
      url: cat ? `/category/${cat.id}` : "/inbox",
      tag: `bot-${row.user_id}`,
    }).catch(() => {});
    return { id: data.id as string };
  }

  if (error.code === "23505" && row.content_hash) {
    const { data: existing } = await svc
      .from("entries")
      .select("id, category_id, title")
      .eq("user_id", row.user_id)
      .eq("content_hash", row.content_hash)
      .maybeSingle();
    if (existing) {
      return {
        duplicate: {
          id: existing.id as string,
          categoryId: existing.category_id as string,
          title: existing.title as string,
        },
      };
    }
  }
  console.error("[bot] entries insert", error);
  return null;
}

/**
 * Compose a save-confirmation reply, accounting for the dedup branch.
 *
 *   inserted == null                → fatal, propagate generic failure msg
 *   inserted.duplicate              → "уже сохранено в <категория>"
 *   inserted.id (default)           → header (+ optional title) + extra
 *
 * `headerOk` is the "Сохранено в …" prefix when the entry is new; the
 * dup branch synthesises its own header from the existing entry's actual
 * category (which can differ from where the bot tried to file it).
 */
function dupOrSavedReply(
  inserted: InsertResult | null,
  headerOk: string,
  title?: string,
  extra?: string,
): string {
  if (!inserted) return "Не удалось сохранить, попробуй ещё раз.";
  if (inserted.duplicate) {
    const cat = getCategory(inserted.duplicate.categoryId as CategoryId);
    const where = cat ? `*${escapeMd(cat.en)}*` : escapeMd(inserted.duplicate.categoryId);
    return `🔁 Уже сохранено в ${where}\n_${escapeMd(inserted.duplicate.title)}_`;
  }
  const lines: string[] = [headerOk];
  if (title) lines[0] += `\n*${escapeMd(title)}*`;
  if (extra) lines.push("\n" + extra);
  return lines.join("");
}

async function fetchYouTubeMeta(videoId: string): Promise<{
  title: string; author: string; thumb: string;
} | null> {
  // 5-second AbortController guard.  YouTube's oEmbed endpoint
  // occasionally stalls from Vercel egress IPs, and without a
  // timeout the entire bot handler would freeze waiting for it
  // (the user sees no reply until Vercel kills the function).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${videoId}&format=json`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title ?? `YouTube ${videoId}`,
      author: data.author_name ?? "",
      thumb: `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================== */

export function getBot(): Bot {
  if (_bot) return _bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
  const bot = new Bot(token);

  // ---- /start, /help ----
  bot.command(["start", "help"], async (ctx) => {
    const user = await ensureUser(ctx);
    const greet = user
      ? `✓ Аккаунт уже привязан.\n\n${HELP_TEXT}`
      : `${HELP_TEXT}\n\n${NOT_LINKED_TEXT}`;
    await safeReply(ctx, greet, { parse_mode: "Markdown" });
  });

  // ---- /link <code> ----
  bot.command("link", async (ctx) => {
    const code = ctx.match.trim();
    if (!code) {
      await safeReply(ctx, "Использование: `/link 482-913`\nКод бери в Settings → Telegram на сайте.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const found = await findUserByLinkCode(code);
    if (!found) {
      await safeReply(ctx, "Код не найден или истёк (срок 10 минут). Сгенерируй новый в /settings.");
      return;
    }
    await attachChatId(found.userId, ctx.chat!.id);
    await safeReply(ctx,
      `✓ Привязано.\nТеперь пересылай мне любой контент — он попадёт в твою базу.\n\nКоманды: /search <запрос> · /unlink · /help`,
      { parse_mode: "Markdown" }
    );
  });

  // ---- /unlink ----
  bot.command("unlink", async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) {
      await safeReply(ctx, "Этот чат не привязан.");
      return;
    }
    await unlinkSession(user.userId);
    await safeReply(ctx, "Отвязано. До новых встреч.");
  });

  // ---- /search ----
  bot.command("search", async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) { await safeReply(ctx, NOT_LINKED_TEXT); return; }
    const q = ctx.match.trim();
    if (q.length < 2) {
      await safeReply(ctx, "Минимум 2 символа.\nПример: `/search next.js`", { parse_mode: "Markdown" });
      return;
    }
    // PostgREST's `.or()` filter takes a comma-separated string of
    // "column.operator.value" triples. User input is interpolated
    // directly into the value, so a `q` containing `,` or `.` or
    // `()` would parse as additional filter clauses. RLS already
    // scopes to the caller's user_id, so the worst-case is a
    // misshapen query against the user's own rows — but escaping
    // is still cheap insurance.
    const safeQ = q.replace(/[,.()*\\]/g, " ").replace(/\s+/g, " ").trim();
    const svc = createServiceClient();
    const { data } = await svc
      .from("entries")
      .select("category_id, title, description, created_at")
      .eq("user_id", user.userId)
      .or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%`)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (!data || data.length === 0) {
      await safeReply(ctx, `Ничего не нашёл по «${q}».`);
      return;
    }
    const lines = data.map((r, i) => {
      const date = String(r.created_at).slice(0, 10);
      return `${i + 1}. *${escapeMd(r.title)}* — ${r.category_id} · ${date}\n   _${escapeMd((r.description ?? "").slice(0, 120))}_`;
    });
    await safeReply(ctx, `🔍 Top ${data.length} по «${q}»:\n\n${lines.join("\n\n")}`, { parse_mode: "Markdown" });
  });

  // ---- Free text ----
  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // commands handled above
    const user = await ensureUser(ctx);
    if (!user) { await safeReply(ctx, NOT_LINKED_TEXT); return; }

    const text = ctx.message.text.trim();

    // YouTube URL?
    const ytId = isYouTubeUrl(text);
    if (ytId) {
      const meta = await fetchYouTubeMeta(ytId);
      const inserted = await createEntryViaBot({
        user_id: user.userId,
        category_id: "youtube",
        title: meta?.title ?? `YouTube ${ytId}`,
        description: meta?.author ? `Канал: ${meta.author}` : null,
        url: `https://www.youtube.com/watch?v=${ytId}`,
        thumb_url: meta?.thumb ?? null,
        tags: [],
        imported_via: "bot",
        metadata: { videoId: ytId },
      });
      await safeReply(ctx, dupOrSavedReply(inserted, "📺 Сохранено в YouTube", meta?.title ?? ytId), { parse_mode: "Markdown" });
      return;
    }

    // Generic URL?
    if (isUrl(text)) {
      // Try to enrich the entry with og: meta — silently falls back to a
      // hostname-only title if the page blocks scraping or times out.
      const meta = await extractMetadata(text);
      let fallbackTitle = text;
      try {
        const u = new URL(text);
        fallbackTitle = `${u.hostname.replace(/^www\./, "")}${u.pathname.length > 1 ? u.pathname : ""}`.slice(0, 200);
      } catch {}
      const inserted = await createEntryViaBot({
        user_id: user.userId,
        category_id: "web",
        title: meta.title ?? fallbackTitle,
        description: meta.description ?? (meta.siteName ? `via ${meta.siteName}` : null),
        url: text,
        thumb_url: meta.image ?? null,
        tags: [],
        imported_via: "bot",
        metadata: meta.siteName ? { siteName: meta.siteName } : undefined,
      });
      await safeReply(ctx, dupOrSavedReply(inserted, "🔗 Сохранено в Web Resources", meta.title), { parse_mode: "Markdown" });
      return;
    }

    // Plain note → Ideas (default holding pattern)
    const inserted = await createEntryViaBot({
      user_id: user.userId,
      category_id: "ideas",
      title: text.slice(0, 80),
      description: text.length > 80 ? text : null,
      tags: [],
      imported_via: "bot",
    });
    await safeReply(ctx, dupOrSavedReply(inserted, "💡 Сохранено в Ideas"), { parse_mode: "Markdown" });
  });

  // ---- Photos ----
  bot.on("message:photo", async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) { await safeReply(ctx, NOT_LINKED_TEXT); return; }
    const caption = ctx.message.caption?.trim() ?? "Photo";
    // Largest photo file
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const inserted = await createEntryViaBot({
      user_id: user.userId,
      category_id: "images",
      title: caption.slice(0, 80) || "Photo from Telegram",
      description: caption,
      tags: [],
      imported_via: "bot",
      metadata: { telegramFileId: photo.file_id, width: photo.width, height: photo.height },
    });
    await safeReply(ctx,
      dupOrSavedReply(inserted, "🖼 Сохранено в Images", caption.slice(0, 80) || undefined,
        "_(полный upload в R2 появится в следующей версии — пока сохраняю Telegram-file_id)_"),
      { parse_mode: "Markdown" }
    );
  });

  // ---- Documents (.md, .pdf, .txt, archives, any file the user forwards) ----
  // Without this, document forwards were silently swallowed — the
  // user would see no reply and nothing landed in Inbox.  We save the
  // filename as title and the Telegram file_id so a future upload-to-R2
  // pass can fetch the bytes via the Bot API.
  bot.on("message:document", async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) { await safeReply(ctx, NOT_LINKED_TEXT); return; }
    const doc = ctx.message.document;
    const caption = ctx.message.caption?.trim() ?? "";
    const filename = doc.file_name ?? "Document";
    // .md / .txt / .pdf / .docx / etc. → Documents; anything else
    // (zips, archives, code drops) → Misc to keep Documents clean.
    const mdLike = /\.(md|markdown|txt|rtf)$/i.test(filename);
    const docLike = /\.(pdf|doc|docx|odt|rtf|epub|pages)$/i.test(filename);
    const categoryId: CategoryId = mdLike || docLike ? "documents" : "misc";
    const inserted = await createEntryViaBot({
      user_id: user.userId,
      category_id: categoryId,
      title: (caption || filename).slice(0, 200),
      description: caption || `Файл из Telegram · ${(doc.file_size ?? 0).toLocaleString("ru-RU")} bytes`,
      tags: [],
      imported_via: "bot",
      metadata: {
        telegramFileId: doc.file_id,
        telegramFileUniqueId: doc.file_unique_id,
        fileName: filename,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
      },
    });
    const where = categoryId === "documents" ? "📄 Сохранено в Documents" : "📦 Сохранено в Misc";
    await safeReply(ctx,
      dupOrSavedReply(inserted, where, filename,
        "_(содержимое подтянется при следующем upload-to-R2 проходе)_"),
      { parse_mode: "Markdown" }
    );
  });

  // ---- Videos ----
  // Telegram-native video (not a YouTube link — those land via the text
  // handler).  Saved to the YouTube category so it sits alongside other
  // watchable content; metadata carries the file_id for later download.
  bot.on("message:video", async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) { await safeReply(ctx, NOT_LINKED_TEXT); return; }
    const video = ctx.message.video;
    const caption = ctx.message.caption?.trim() ?? "";
    const title = (caption || video.file_name || "Video from Telegram").slice(0, 200);
    const inserted = await createEntryViaBot({
      user_id: user.userId,
      category_id: "youtube",
      title,
      description: caption || (video.duration ? `${video.duration}s · ${video.width}×${video.height}` : null),
      tags: [],
      imported_via: "bot",
      metadata: {
        telegramFileId: video.file_id,
        telegramFileUniqueId: video.file_unique_id,
        fileName: video.file_name,
        mimeType: video.mime_type,
        fileSize: video.file_size,
        duration: video.duration,
        width: video.width,
        height: video.height,
      },
    });
    await safeReply(ctx, dupOrSavedReply(inserted, "🎬 Сохранено в YouTube", title), { parse_mode: "Markdown" });
  });

  // ---- Audio / voice notes ----
  // Music tracks (audio) carry artist + title; voice notes are
  // anonymous .ogg blobs.  Both land in Misc with the file_id so a
  // future transcribe pass can populate the body.
  bot.on(["message:audio", "message:voice"], async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) { await safeReply(ctx, NOT_LINKED_TEXT); return; }
    const caption = ctx.message.caption?.trim() ?? "";
    const audio = ctx.message.audio;
    const voice = ctx.message.voice;
    // Narrow on the discriminator first so each branch keeps the
    // right shape — earlier draft used `a = audio ?? voice` and lost
    // the title/performer fields during type narrowing.
    let title: string = caption;
    let description: string;
    let tags: string[];
    let metaKind: "audio" | "voice";
    let fileId: string;
    let fileUniqueId: string;
    let mimeType: string | undefined;
    let fileSize: number | undefined;
    let duration: number;
    if (audio) {
      const niceTitle = audio.performer && audio.title
        ? `${audio.performer} — ${audio.title}`
        : audio.title ?? null;
      if (!title) title = niceTitle ?? "Audio from Telegram";
      description = caption || "Audio";
      tags = ["audio"];
      metaKind = "audio";
      fileId = audio.file_id;
      fileUniqueId = audio.file_unique_id;
      mimeType = audio.mime_type;
      fileSize = audio.file_size;
      duration = audio.duration;
    } else if (voice) {
      if (!title) title = `Голосовое · ${voice.duration}s`;
      description = caption || "Голосовое сообщение";
      tags = ["voice"];
      metaKind = "voice";
      fileId = voice.file_id;
      fileUniqueId = voice.file_unique_id;
      mimeType = voice.mime_type;
      fileSize = voice.file_size;
      duration = voice.duration;
    } else {
      return;
    }
    const inserted = await createEntryViaBot({
      user_id: user.userId,
      category_id: "misc",
      title: title.slice(0, 200),
      description,
      tags,
      imported_via: "bot",
      metadata: {
        telegramFileId: fileId,
        telegramFileUniqueId: fileUniqueId,
        mimeType,
        fileSize,
        duration,
        kind: metaKind,
      },
    });
    await safeReply(ctx,
      dupOrSavedReply(
        inserted,
        metaKind === "voice" ? "🎙 Сохранено в Misc (voice)" : "🎵 Сохранено в Misc (audio)",
        title,
      ),
      { parse_mode: "Markdown" },
    );
  });

  // ---- Catch-all for anything else (stickers, GIFs, contacts,
  // forwarded posts with no text/file we can extract).  Without this,
  // edge-case forwards just vanish; the user would see no Inbox entry
  // and have no idea why.  We save a thin placeholder so the message
  // at least shows up — better than silent drop.
  bot.on("message", async (ctx) => {
    if (ctx.message.text?.startsWith("/")) return;
    const user = await ensureUser(ctx);
    if (!user) return;
    // Stickers and animations have their own discoverable shape.
    let label = "Пересланное сообщение";
    let extraMeta: Record<string, unknown> = {};
    if (ctx.message.sticker) {
      label = `Sticker · ${ctx.message.sticker.emoji ?? ""}`.trim();
      extraMeta = { telegramFileId: ctx.message.sticker.file_id, emoji: ctx.message.sticker.emoji };
    } else if (ctx.message.animation) {
      label = ctx.message.animation.file_name ?? "GIF from Telegram";
      extraMeta = { telegramFileId: ctx.message.animation.file_id };
    } else if (ctx.message.video_note) {
      label = `Кружочек · ${ctx.message.video_note.duration}s`;
      extraMeta = { telegramFileId: ctx.message.video_note.file_id, duration: ctx.message.video_note.duration };
    } else if (ctx.message.contact) {
      label = `Контакт · ${ctx.message.contact.first_name ?? ""} ${ctx.message.contact.phone_number ?? ""}`.trim();
      extraMeta = { contact: ctx.message.contact };
    } else if (ctx.message.location) {
      label = `Гео · ${ctx.message.location.latitude}, ${ctx.message.location.longitude}`;
      extraMeta = { location: ctx.message.location };
    } else if (ctx.message.poll) {
      label = `Опрос · ${ctx.message.poll.question}`;
      extraMeta = { poll: ctx.message.poll };
    } else if (ctx.message.forward_origin) {
      // Forwarded message that didn't trip any of the typed handlers —
      // happens e.g. when a channel post has a media payload Telegram
      // describes only via service fields.  Save what we have.
      label = "Пересылка из Telegram";
    } else {
      // Truly unknown message shape — don't pollute Inbox with empty
      // entries, just log and bail.  We still won't reply to avoid the
      // bot looking like it loops on system events.
      console.warn("[bot] unhandled message shape; keys=", Object.keys(ctx.message));
      return;
    }
    const inserted = await createEntryViaBot({
      user_id: user.userId,
      category_id: "misc",
      title: label.slice(0, 200),
      description: ctx.message.caption?.trim() ?? null,
      tags: ["telegram"],
      imported_via: "bot",
      metadata: { ...extraMeta, forwardOrigin: ctx.message.forward_origin ?? null },
    });
    await safeReply(ctx, dupOrSavedReply(inserted, "📥 Сохранено в Misc", label), { parse_mode: "Markdown" });
  });

  // ---- Errors ----
  bot.catch((err) => {
    if (err.error instanceof GrammyError) {
      console.error("[bot] grammY error:", err.error.description);
    } else {
      console.error("[bot] unexpected:", err);
    }
  });

  _bot = bot;
  return bot;
}

function escapeMd(s: string): string {
  return s.replace(/[*_`[\]]/g, "\\$&");
}
