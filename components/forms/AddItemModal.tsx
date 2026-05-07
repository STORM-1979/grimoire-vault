"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Field } from "./Field";
import { FileUpload } from "./FileUpload";
import { CollectionSelect } from "./CollectionSelect";
import { ThemedSelect, type SelectOption } from "./ThemedSelect";
import { getCategory, isMediaCategory, isVideoCategory } from "@/lib/categories";
import { extractApi, ApiError } from "@/lib/api-client";
import { humanSize } from "@/lib/utils";
import { resolveYouTubeDuration, youtubeVideoId } from "@/lib/youtube-client";
import { siteScreenshot } from "@/lib/screenshot";
import { translateToRussianBrowser } from "@/lib/translate-client";
import { useEntryTemplates, type EntryTemplate } from "@/lib/hooks/useEntryTemplates";
import type { CategoryId, EntryCollection } from "@/lib/types";
import type { CreateEntryInput } from "@/lib/schemas/entries";

interface DuplicateInfo {
  id: string;
  categoryId: string;
  title: string;
}

interface Props {
  categoryId: CategoryId;
  onClose: () => void;
  onSubmit: (input: CreateEntryInput) => Promise<void>;
  /** User-defined collections inside this category, if the parent
   * already loaded them.  Optional — when omitted (or empty), the
   * collection picker is hidden. */
  collections?: EntryCollection[];
  /** Pre-select this collection in the picker — passes through the
   * currently active collection chip from the category page. */
  defaultCollectionId?: string | null;
}

// Prompt-model presets shown in the Модель selector.  Kept in one
// place so AddItemModal and EditEntryModal stay in sync.
const PROMPT_MODELS: SelectOption[] = [
  { value: "Opus 4.7", label: "Claude Opus 4.7" },
  { value: "Sonnet 4.6", label: "Claude Sonnet 4.6" },
  { value: "Haiku 4.5", label: "Claude Haiku 4.5" },
  { value: "GPT-5", label: "GPT-5" },
  { value: "Gemini 2.5", label: "Gemini 2.5" },
];

const EMPTY_FORM = {
  title: "", desc: "", tags: "", pinned: false,
  url: "", thumb: "", cover: "", duration: "", size: "", count: "", model: "",
  // Bytes of the most recently uploaded cover (post-compression) — set
  // by FileUpload's onMeta callback for media categories so we can
  // persist sizeBytes / sizeLabel on submit and render the weight on
  // the card.  Stays 0 if the user pasted a URL instead of uploading.
  coverBytes: 0,
  // Portfolio project links — surfaced as dedicated inputs only when
  // categoryId === "portfolio", persisted under entry.metadata so we
  // don't churn the entries schema.
  vercelUrl: "", gitUrl: "", dbUrl: "",
};

export function AddItemModal({
  categoryId, onClose, onSubmit, collections, defaultCollectionId,
}: Props) {
  const router = useRouter();
  const cat = getCategory(categoryId);
  const isVideo = isVideoCategory(categoryId);
  const isMedia = isMediaCategory(categoryId);
  const isWeb = categoryId === "web";
  const isDoc = categoryId === "documents";
  const isLocal = categoryId === "local";
  const isPrompt = categoryId === "prompts";
  const isIdea = categoryId === "ideas";
  const isImage = categoryId === "images";
  const isPortfolio = categoryId === "portfolio";
  // For these text-first categories the source link is supplementary
  // — the user types a title and the body text first, the link is
  // optional context.  Putting the URL field above name/description
  // would push the primary inputs below the fold.  Skills keeps the
  // URL on top because pasting the install command is the workflow
  // trigger that drives og:meta extraction.
  const urlBelowDescription = isPrompt || isIdea;
  // Designs is conceptually a media category (uses MediaCard for
  // cover rendering) but the user adds entries by pasting a URL —
  // a Behance / Dribbble / studio site / article — and the cover
  // comes from og:image automatically.  No upload, no manual image
  // URL field.
  const isDesign = categoryId === "designs";
  // Text-first categories — no built-in URL or file extractor of their
  // own, but we still expose an optional "Источник (URL)" input at the
  // top.  Pasting any link runs the same /api/extract pipeline used by
  // Web/YouTube and pre-fills title/description/tags so the user only
  // tweaks what's wrong.  Empty fields only — manual edits always win.
  const isText = categoryId === "skills"
    || categoryId === "prompts"
    || categoryId === "ideas"
    || categoryId === "misc";

  const [form, setForm] = useState({ ...EMPTY_FORM });
  // Per-category presets (Skills / Prompts / Ideas / Active Projects
  // ship seeded defaults; everything else starts empty).  Picking a
  // template patches title / desc / tags only — fields the user
  // explicitly typed are never overwritten.
  const { templates } = useEntryTemplates(categoryId);
  const applyTemplate = (tpl: EntryTemplate) => {
    setForm((f) => ({
      ...f,
      title: f.title.trim() ? f.title : (tpl.title ?? f.title),
      desc: f.desc.trim() ? f.desc : (tpl.desc ?? f.desc),
      tags: f.tags.trim() ? f.tags : (tpl.tags ?? []).join(", "),
    }));
  };
  // Collection picker state — separate from `form` because it's only
  // present for categories that have collections, and we don't want
  // to widen EMPTY_FORM with a field most categories never use.
  const [collectionId, setCollectionId] = useState<string | null>(
    defaultCollectionId && defaultCollectionId !== "none" ? defaultCollectionId : null,
  );
  const [submitting, setSubmitting] = useState(false);
  // Ref mirror of the submit flag — synchronous guard against true
  // rapid-fire clicks that beat React's state batching (touch
  // double-tap, accidental Enter+click, etc).  Avoids creating two
  // entries for one user intent.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server rejects with 409 (unique content_hash hit).
  // The modal stays open and replaces the error banner with a CTA that
  // deep-links to the existing entry's category.
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  // og: extraction state — purely advisory UX feedback while the user
  // pastes a link.  The actual fetch happens via /api/extract.
  // Mirrored on a ref so requestClose can poll the live value (state
  // is captured in closures and never updates inside an async loop).
  const [extracting, setExtracting] = useState(false);
  const extractingRef = useRef(false);
  // For video category: until the URL is pasted (or the user clicks
  // "fill manually"), the form shows just one URL input.  Other fields
  // appear after extraction succeeds OR the user opts out of auto-fill.
  const [videoExpanded, setVideoExpanded] = useState(false);
  // Carry the extracted preview separately so the user can see what
  // was pulled even before deciding to edit.
  const [extractError, setExtractError] = useState<string | null>(null);
  const lastExtractedUrl = useRef<string>("");
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After a failed save (409 duplicate or any error) we remember the URL
  // that failed so close-with-pending doesn't loop into the same error
  // again.  Cleared whenever the user changes the URL.
  const failedUrl = useRef<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: (e.target as HTMLInputElement).type === "checkbox"
        ? (e.target as HTMLInputElement).checked
        : e.target.value });

  // requestClose is declared later (it depends on submitInput which
  // depends on the form state).  We expose it via a ref so the
  // window-level Esc handler — which mounts during the first render —
  // can call the latest version without re-attaching the listener
  // every keystroke.
  const requestCloseRef = useRef<() => void | Promise<void>>(() => onClose());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void requestCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-extract og: meta when the URL field becomes a real URL.
  // Only fills *empty* fields — the user's typing always wins.
  // For video entries we also pull duration + tags + channel author
  // (server-side oEmbed fallback covers UA-blocked YouTube pages).
  useEffect(() => {
    // For portfolio entries the extraction trigger is the Vercel /
    // prod URL field, not the generic url input — that one isn't
    // even shown for portfolio.  Other categories keep using form.url.
    const sourceUrl = isPortfolio ? form.vercelUrl.trim() : form.url.trim();
    const url = sourceUrl;
    // URL changed — clear the "this URL already failed to save" marker
    // so close-with-pending can try again on the new value.
    if (failedUrl.current && failedUrl.current !== url) failedUrl.current = null;
    if (!(isWeb || isVideo || isText || isDesign || isPortfolio) || url.length < 8) return;

    // Try the input as-is first.  If that fails, scan for the first
    // embedded http(s) URL — handy when the user pastes a shell
    // command like `npx skills add https://github.com/foo/bar`.  We
    // keep the original text in the field (the surrounding command
    // is the actionable artefact the user wants to remember), and
    // only use the embedded URL for the metadata fetch.
    let parsed: URL | null = null;
    let metaUrl = url;
    try { parsed = new URL(url); } catch { /* embedded-URL fallback below */ }
    if (!parsed) {
      const m = url.match(/https?:\/\/[^\s)>"'`]+/);
      if (!m) return;
      try { parsed = new URL(m[0]); } catch { return; }
      metaUrl = m[0];
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    // Dedupe on the EMBEDDED url — same shell command + same link =
    // no need to re-fetch og:meta.
    if (lastExtractedUrl.current === metaUrl) return;
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(async () => {
      lastExtractedUrl.current = metaUrl;
      setExtracting(true);
      extractingRef.current = true;
      setExtractError(null);
      try {
        const meta = await extractApi.fromUrl(metaUrl);
        if (!meta.hasContent) {
          if (isVideo) {
            setExtractError("Не удалось подтянуть данные. Заполни поля вручную.");
            setVideoExpanded(true);
          }
          return;
        }
        // Auto-translate the og:title / og:description to Russian
        // when extraction lands an English (or other non-Russian)
        // page — most Skills sources are GitHub repos or English
        // tutorials.  Translation is a no-op for already-Russian
        // text and falls through to the original on network error.
        // Applied to text-first AND web/video so every category
        // benefits, while staying skip-on-Russian for existing
        // RU-source workflows.
        if (meta.title) {
          meta.title = await translateToRussianBrowser(meta.title);
        }
        if (meta.description) {
          meta.description = await translateToRussianBrowser(meta.description);
        }
        // Reveal the rest of the video form now that we have content to show.
        if (isVideo) setVideoExpanded(true);
        setForm((f) => {
          // For video: prepend channel name to description if we have it
          // and the user hasn't typed anything yet.
          const videoDesc = isVideo && meta.author && meta.description
            ? `Канал: ${meta.author}\n\n${meta.description}`
            : isVideo && meta.author
            ? `Канал: ${meta.author}`
            : meta.description;
          // Tags intentionally NOT auto-filled — `meta.tags` for video
          // pages comes from `<meta name="keywords">` which on YouTube
          // is the same generic site-wide list ("видео, поделиться,
          // телефон с камерой") for almost every video.  User decides
          // what's worth tagging.
          // Designs: when the page has no og:image, fall back to a
          // free hero-block screenshot via Microlink so the card
          // never lands with an empty cover rectangle.
          // Description for designs is intentionally NOT autofilled
          // (user request — they want title + cover, nothing else).
          // Portfolio gets the same hero-block fallback because most
          // Vercel deployments don't ship custom og:image tags.
          const wantsScreenshotFallback = isDesign || isPortfolio;
          const screenshotFallback = wantsScreenshotFallback && !meta.image
            ? siteScreenshot(metaUrl)
            : null;
          return {
            ...f,
            title: f.title.trim() ? f.title : (meta.title ?? f.title),
            desc: isDesign
              ? f.desc
              : (f.desc.trim() ? f.desc : (videoDesc ?? f.desc)),
            thumb: f.thumb.trim() ? f.thumb : (meta.image ?? f.thumb),
            cover: f.cover.trim()
              ? f.cover
              : (meta.image ?? screenshotFallback ?? f.cover),
            duration: f.duration.trim() ? f.duration : (meta.duration ?? f.duration),
          };
        });
        // Server-side fallback chain (scrape / oEmbed / innertube /
        // mobile / Invidious) frequently fails on Vercel because
        // YouTube and most public mirrors block its egress IPs.  As a
        // last resort, ask the user's browser to fetch the duration
        // for us — residential IPs aren't blocked.  Two paths inside
        // resolveYouTubeDuration: CORS-friendly Invidious first, then
        // an off-screen YT IFrame Player API call.
        if (isVideo && !meta.duration && youtubeVideoId(metaUrl)) {
          const dur = await resolveYouTubeDuration(metaUrl);
          if (dur) {
            setForm((f) => ({
              ...f,
              duration: f.duration.trim() ? f.duration : dur,
            }));
          }
        }
      } catch {
        // Silent — extraction is a nicety, not a feature.
        if (isVideo) {
          setExtractError("Сервис извлечения недоступен. Заполни поля вручную.");
          setVideoExpanded(true);
        }
      } finally {
        setExtracting(false);
        extractingRef.current = false;
      }
    }, 600);
    return () => {
      if (extractTimer.current) clearTimeout(extractTimer.current);
    };
  }, [form.url, form.vercelUrl, isWeb, isVideo, isText, isDesign, isPortfolio]);

  /**
   * Build the CreateEntryInput payload from the current form state and
   * fire it at the parent's `onSubmit`.  Returns `{ ok, savedTitle? }`
   * so callers can decide whether to close, reset, or surface an error.
   *
   * On 409 (duplicate content_hash) the server's `existing` payload gets
   * pinned into `duplicate` state so we can render the deep-link CTA.
   * On any other failure we set `error`.  Either way the modal stays
   * mounted — only the caller decides what to do with the result.
   */
  const submitInput = async (): Promise<{ ok: boolean; savedTitle?: string }> => {
    const input: CreateEntryInput = {
      categoryId,
      title: form.title.trim(),
      description: form.desc.trim() || undefined,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      pinned: form.pinned,
      metadata: {},
      importedVia: "web",
    };
    // Always preserve a non-empty url — the field is hooked up to
    // FileUpload (documents/local), the URL input (web/text/video),
    // and Cover URL (media).  Without this, document/local entries
    // had a real R2 file but entry.url stayed empty, so the detail
    // page couldn't render the inline preview.
    if (form.url.trim()) input.url = form.url.trim();
    // Collection assignment — only persisted when the picker is
    // visible (collections were passed in) and a real id is selected.
    if (collectionId) input.collectionId = collectionId;
    if (isVideo) {
      if (form.thumb.trim()) input.thumbUrl = form.thumb.trim();
      if (form.duration.trim()) input.duration = form.duration.trim();
    }
    if (isMedia && form.cover.trim()) input.coverUrl = form.cover.trim();
    // Persist the cover-image weight so the card can render it.
    // Skipped for designs (cover comes from og:image / screenshot,
    // not a real upload — bytes would be misleading).
    if (isMedia && !isDesign && form.coverBytes > 0) {
      input.sizeBytes = form.coverBytes;
      input.sizeLabel = humanSize(form.coverBytes);
    }
    if (isImage && form.count) {
      const n = parseInt(form.count, 10);
      if (!isNaN(n)) input.fileCount = n;
    }
    if ((isDoc || isLocal) && form.size.trim()) input.sizeLabel = form.size.trim();
    if (isPrompt && form.model.trim()) input.metadata = { ...input.metadata, model: form.model.trim() };
    // Portfolio project links — persist any non-empty value.  All
    // three are optional; we strip empties so the metadata stays
    // clean and the project-panel renderer doesn't show empty rows.
    if (isPortfolio) {
      const projectMeta: Record<string, string> = {};
      if (form.vercelUrl.trim()) projectMeta.vercelUrl = form.vercelUrl.trim();
      if (form.gitUrl.trim())    projectMeta.gitUrl    = form.gitUrl.trim();
      if (form.dbUrl.trim())     projectMeta.dbUrl     = form.dbUrl.trim();
      if (Object.keys(projectMeta).length) {
        input.metadata = { ...input.metadata, ...projectMeta };
      }
    }

    try {
      await onSubmit(input);
      return { ok: true, savedTitle: input.title };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { existing?: DuplicateInfo } | null;
        if (body?.existing?.id) {
          // Server already has this URL.  Surface the banner clearly,
          // then auto-navigate to the existing entry after 3.5 s —
          // matches user intent ("I want to see this video") and gives
          // them time to read what's happening before the redirect.
          // The banner itself is sticky to the bottom of the modal so
          // it can't get lost below the fold.
          setDuplicate(body.existing);
          failedUrl.current = form.url.trim() || null;
          const targetId = body.existing.id;
          setTimeout(() => {
            onClose();
            router.push(`/entry/${targetId}`);
          }, 3500);
          return { ok: false };
        }
      }
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      failedUrl.current = form.url.trim() || null;
      return { ok: false };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Double-submit guard.  Both the React state and the ref are
    // checked: state covers the common case, ref catches racy clicks
    // that fire before setSubmitting takes effect (touch double-tap,
    // Enter+click).  Disabled buttons alone are easy to bypass.
    if (submitting || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setDuplicate(null);
    if (!form.title.trim()) {
      submittingRef.current = false;
      return;
    }
    setSubmitting(true);
    const result = await submitInput();
    setSubmitting(false);
    submittingRef.current = false;
    if (!result.ok) return;
    onClose();
  };

  /**
   * Auto-save-on-close: when the user dismisses the modal (Esc, Cancel,
   * overlay click, header X) AND there's a pending URL with an
   * extracted/typed title, persist it to the DB before unmounting.
   * Skipped if a banner is already showing (user has been informed and
   * the next dismiss is "force close"), if the same URL has already
   * failed (no retry loops), or if a save is already in flight.
   */
  const requestClose = async () => {
    if (submitting || submittingRef.current) return;
    const pendingUrl = form.url.trim();
    // Fast-close paths: when there's already a banner up (the user has
    // SEEN the result of the previous submit) OR this URL has already
    // failed once, there's nothing to auto-save — close immediately
    // without waiting for any background extraction.  Without this
    // guard the IFrame-Player-API duration fetcher (which can run for
    // up to 6 s after paste) makes the modal feel frozen on Cancel.
    if (duplicate || error || failedUrl.current === pendingUrl) {
      onClose();
      return;
    }
    // Otherwise wait for in-flight extraction so auto-save sees the
    // final form state (duration / description / etc).  Polled via a
    // ref — state values are captured in this closure and never
    // update inside an async loop.  8 s cap so a stalled network
    // doesn't freeze the close indefinitely.
    if (extractingRef.current) {
      const startedAt = Date.now();
      while (extractingRef.current && Date.now() - startedAt < 8000) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const pendingTitle = form.title.trim();
    const hasPending = isVideo && !!pendingUrl && !!pendingTitle;
    if (!hasPending) {
      onClose();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const result = await submitInput();
    setSubmitting(false);
    submittingRef.current = false;
    if (result.ok) onClose();
    // On failure: banner is now visible, modal stays open.  Next
    // Cancel hits the fast-close path above (duplicate/error set)
    // and dismisses cleanly.
  };

  // Keep the ref pointing at the latest closure so the Esc listener
  // always sees current form state.  Mutating refs is only legal inside
  // an effect (the React rules-of-hooks lint rule enforces this).
  useEffect(() => { requestCloseRef.current = requestClose; });

  if (!cat) return null;

  const cta = isVideo ? "Добавить видео"
    : isMedia ? "Добавить превью"
    : isWeb ? "Добавить ссылку"
    : isDoc ? "Добавить документ"
    : isPrompt ? "Добавить промпт"
    : "Добавить запись";

  const titleDisabled = !form.title.trim() || submitting;

  return (
    <div className="modal-overlay" onClick={() => void requestClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between p-7 pb-5 border-b border-white/10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">№ {cat.no} · {cat.en}</div>
            <h3 className="font-display text-[32px] font-medium leading-none">{cta}</h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">{cat.ru}</div>
          </div>
          <button onClick={() => void requestClose()} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          {isVideo && (
            <Field
              label="Ссылка на видео"
              hint={
                extracting
                  ? "Тяну название, описание, превью и длительность…"
                  : videoExpanded
                  ? "Поля ниже подтянулись автоматически — поправь, если что не так"
                  : "Вставь YouTube-ссылку. Название, описание, превью и длительность заполнятся сами. Теги добавь руками."
              }
            >
              <input
                ref={urlInputRef}
                autoFocus
                type="url"
                className="field-input"
                value={form.url}
                onChange={set("url")}
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </Field>
          )}

          {isVideo && !videoExpanded && extractError && (
            <div className="mb-4 font-mono text-[11px] text-amber-300/90 flex items-center gap-2">
              <Icon name="x" size={12} /> {extractError}
            </div>
          )}

          {isVideo && !videoExpanded && (
            <button
              type="button"
              onClick={() => setVideoExpanded(true)}
              className="mb-4 font-mono text-[10px] uppercase tracking-widest text-ivory-mute hover:text-gold transition"
            >
              · или заполнить вручную →
            </button>
          )}

          {/* Source URL — shown above title for text-first categories
              EXCEPT those flagged via urlBelowDescription (prompts +
              ideas).  Those put the link under the body text so name
              and description sit at the top of the form. */}
          {isText && !urlBelowDescription && (
            <Field
              label="Ссылка (необязательно)"
              hint={
                extracting
                  ? "Подтягиваю заголовок и описание со страницы…"
                  : "Можно вставить целиком команду или ссылку — заголовок и описание подтянутся по URL внутри."
              }
            >
              {/* type="text", not "url": the field accepts the full
                  user input (e.g. "npx skills add https://github…
                  --skill find-skills") and we extract just the URL
                  for og:meta lookup. HTML5 url validation would
                  reject anything that doesn't START with a scheme. */}
              <input
                type="text"
                className="field-input"
                value={form.url}
                onChange={set("url")}
                placeholder="https://… или команда установки со ссылкой внутри"
              />
            </Field>
          )}

          {(!isVideo || videoExpanded) && (
            <>
              {/* Template picker — only when this category has any
                  presets and the user hasn't started typing yet.
                  Disappears once a title or description is in place
                  so it doesn't clutter the form mid-edit. */}
              {templates.length > 0 && !form.title.trim() && !form.desc.trim() && (
                <div className="mb-4">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mb-2">
                    Шаблон →
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
                        title="Подставить шаблон в форму"
                      >
                        <Icon name="add" size={11} /> {tpl.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Field label="Название" required>
                <input
                  autoFocus={!isVideo && !isText && !isDesign}
                  type="text"
                  className="field-input"
                  value={form.title}
                  onChange={set("title")}
                  placeholder={isVideo ? "Подтянется из YouTube — или впиши вручную" : isText ? "Подтянется из URL — или впиши вручную" : "Краткий заголовок"}
                />
              </Field>

              <Field
                label={isPrompt ? "Текст промпта" : "Описание"}
                hint={isPrompt ? "Сюда вставь сам промпт целиком — карточка скопирует это поле по клику." : undefined}
              >
                <textarea
                  className={"field-textarea" + (isPrompt ? " min-h-[180px]" : "")}
                  value={form.desc}
                  onChange={set("desc")}
                  placeholder={
                    isVideo
                      ? "Канал и заметки"
                      : isPrompt
                      ? "Полный текст промпта…"
                      : isText
                      ? "Подтянется из URL — или впиши вручную"
                      : "Что это, зачем сохранил, ключевая мысль…"
                  }
                />
              </Field>

              {/* Body-first text categories (prompts, ideas) put the
                  source link under the description so the eye lands
                  on title → text first.  Hint text adapts per
                  category — promptly says "where the prompt came
                  from", ideas say "источник вдохновения". */}
              {urlBelowDescription && (
                <Field
                  label="Ссылка (необязательно)"
                  hint={
                    extracting
                      ? "Подтягиваю заголовок и описание со страницы…"
                      : isPrompt
                      ? "Откуда взят промпт — статья, твит, репозиторий."
                      : "Источник идеи — статья, твит, любая ссылка."
                  }
                >
                  <input
                    type="text"
                    className="field-input"
                    value={form.url}
                    onChange={set("url")}
                    placeholder="https://…"
                  />
                </Field>
              )}
            </>
          )}

          {isVideo && videoExpanded && (
            <>
              <FileUpload
                kind="thumbs"
                accept="image/*"
                maxBytes={5 * 1024 * 1024}
                value={form.thumb}
                onChange={(url) => setForm((f) => ({ ...f, thumb: url }))}
                label="Превью видео — загрузить"
                hint="WebP / JPEG / PNG · до 5 MB. Или вставь URL ниже."
              />
              <Field label="…или URL превью">
                {/* type="text" instead of "url": HTML5 url validation
                    rejects our internal "/api/r2/object/..." paths
                    because they're not absolute schemes. Zod still
                    enforces the right format on the server. */}
                <input type="text" className="field-input" value={form.thumb} onChange={set("thumb")}
                  placeholder="https://images.unsplash.com/photo-... или /api/r2/object/..." />
              </Field>
              <Field label="Длительность">
                <input type="text" className="field-input" value={form.duration} onChange={set("duration")}
                  placeholder="12:34" />
              </Field>
            </>
          )}

          {/* Designs: URL-only flow.  No upload; cover comes from
              og:image of the pasted page (Behance / Dribbble /
              studio site / article).  Title + description fill
              from og: meta via the extraction effect above. */}
          {isDesign && (
            <Field
              label="Ссылка на сайт / страницу"
              hint={
                extracting
                  ? "Подтягиваю название и превью со страницы…"
                  : "Вставь ссылку — название и обложка подставятся автоматически"
              }
            >
              <input
                autoFocus
                type="url"
                className="field-input"
                value={form.url}
                onChange={set("url")}
                placeholder="https://… (Behance / Dribbble / студийный сайт)"
              />
            </Field>
          )}

          {isMedia && !isDesign && (
            <>
              <FileUpload
                kind="covers"
                accept="image/*"
                maxBytes={10 * 1024 * 1024}
                value={form.cover}
                onChange={(url) => setForm((f) => ({ ...f, cover: url }))}
                onMeta={(meta) => {
                  // Cover-image filename → entry title — same logic as
                  // the document/local upload, just for media categories
                  // (images / portfolio). Empty-only fill. Also capture
                  // the post-compression bytes so the card can show
                  // the file weight.
                  setForm((f) => ({
                    ...f,
                    title: f.title.trim() ? f.title : (meta.suggestedTitle ?? ""),
                    coverBytes: meta.size,
                  }));
                }}
                label="Обложка — загрузить"
                hint="WebP / JPEG / PNG · до 10 MB. Или вставь URL ниже."
              />
              <Field label="…или URL обложки">
                {/* See note on the thumb field — same reason. */}
                <input type="text" className="field-input" value={form.cover} onChange={set("cover")}
                  placeholder="https://images.unsplash.com/photo-... или /api/r2/object/..." />
              </Field>
            </>
          )}

          {isImage && (
            <Field label="Кол-во файлов в коллекции">
              <input type="number" min="1" className="field-input" value={form.count} onChange={set("count")} placeholder="12" />
            </Field>
          )}

          {/* Portfolio project links.  All three are optional and
              persisted under entry.metadata — pure flat URL fields,
              no schema migration needed.  The Vercel field doubles
              as the og:meta source: pasting it pre-fills название,
              описание, обложку (hero-block screenshot fallback when
              the deployment ships no og:image, like designs do). */}
          {isPortfolio && (
            <>
              <Field
                label="Vercel / прод-ссылка"
                hint={
                  extracting
                    ? "Подтягиваю название, описание и превью со страницы…"
                    : "Вставь ссылку — название, описание и обложка подтянутся автоматически."
                }
              >
                <input
                  type="text"
                  className="field-input"
                  value={form.vercelUrl}
                  onChange={set("vercelUrl")}
                  placeholder="https://my-project.vercel.app"
                />
              </Field>
              <Field label="GitHub / репозиторий">
                <input
                  type="text"
                  className="field-input"
                  value={form.gitUrl}
                  onChange={set("gitUrl")}
                  placeholder="https://github.com/me/project"
                />
              </Field>
              <Field label="БД / админ-панель">
                <input
                  type="text"
                  className="field-input"
                  value={form.dbUrl}
                  onChange={set("dbUrl")}
                  placeholder="https://supabase.com/dashboard/project/…"
                />
              </Field>
            </>
          )}

          {isWeb && (
            <Field
              label="URL ресурса"
              hint={
                extracting
                  ? "Подтягиваю заголовок и превью со страницы…"
                  : "Вставь ссылку — заголовок, описание и превью подставятся автоматически"
              }
            >
              <input type="url" className="field-input" value={form.url} onChange={set("url")} placeholder="https://example.com" />
            </Field>
          )}

          {(isDoc || isLocal) && (
            <>
              <FileUpload
                kind="originals"
                maxBytes={100 * 1024 * 1024}
                value={form.url}
                onChange={(url) => setForm((f) => ({ ...f, url }))}
                onMeta={(meta) => {
                  // Pre-fill title and size on file selection — runs
                  // BEFORE the upload, so the user gets the autofill
                  // even if R2 rejects the MIME and we have to retry.
                  // Only fills empty fields — manual edits always win.
                  setForm((f) => ({
                    ...f,
                    title: f.title.trim() ? f.title : (meta.suggestedTitle ?? ""),
                    size: f.size.trim() ? f.size : humanSize(meta.size),
                  }));
                }}
                label="Файл — загрузить"
                hint="PDF · DjVu · DOC/DOCX/XLSX/PPTX · ZIP/RAR/7z · EPUB/MOBI/FB2 · video/audio/image · до 100 MB"
              />
              <Field label="Размер (display label)">
                <input type="text" className="field-input" value={form.size} onChange={set("size")} placeholder="2.4 MB" />
              </Field>
            </>
          )}

          {isPrompt && (
            <Field label="Модель">
              <ThemedSelect
                options={PROMPT_MODELS}
                value={form.model}
                onChange={(v) => setForm((f) => ({ ...f, model: v }))}
              />
            </Field>
          )}

          {(!isVideo || videoExpanded) && (
            <>
              {collections && collections.length > 0 && (
                <Field label="Коллекция" hint="Группа внутри текущей категории">
                  <CollectionSelect
                    collections={collections}
                    value={collectionId}
                    onChange={setCollectionId}
                  />
                </Field>
              )}

              <Field label="Теги (через запятую)" hint="Например: frontend, чтение, важное">
                <input type="text" className="field-input" value={form.tags} onChange={set("tags")} placeholder="tag1, tag2, tag3" />
              </Field>

              <label className="flex items-center gap-3 mt-2 mb-6 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-emerald-500"
                  checked={form.pinned}
                  onChange={set("pinned")}
                />
                <span className="text-[13px] text-ivory-dim flex items-center gap-1.5">
                  <Icon name="pin" size={13} className="text-gold" /> Закрепить наверху
                </span>
              </label>
            </>
          )}

          {duplicate && (
            <div className="mb-4 p-3 rounded-lg border border-gold/40 bg-gold/[0.06] flex items-start gap-3 sticky bottom-3 z-10 backdrop-blur">
              <Icon name="check" size={14} className="text-gold mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
                  Уже сохранено · № {getCategory(duplicate.categoryId as CategoryId)?.no} · {getCategory(duplicate.categoryId as CategoryId)?.en} · перехожу к записи…
                </div>
                <div className="font-display text-[15px] font-medium leading-tight truncate mb-2">
                  «{duplicate.title}»
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/entry/${duplicate.id}`}
                    onClick={onClose}
                    className="font-mono text-[10px] uppercase tracking-widest px-3 py-1 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
                  >
                    <Icon name="arrow" size={11} /> Открыть сейчас
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDuplicate(null)}
                    className="font-mono text-[10px] uppercase tracking-widest px-3 py-1 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition"
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          )}
          {error && !duplicate && (
            <div className="mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
              <Icon name="x" size={12} /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-5 border-t border-white/10 -mx-7 px-7">
            <button
              type="button"
              onClick={() => void requestClose()}
              className="border border-white/20 text-ivory-dim px-5 py-2.5 rounded-full font-medium tracking-tight hover:border-white/40 hover:text-ivory transition"
              title="Закрыть"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={titleDisabled}
              className="bg-ivory text-emerald-950 px-6 py-2.5 rounded-full font-medium tracking-tight hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Icon name="add" size={16} /> {submitting ? "..." : cta}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
