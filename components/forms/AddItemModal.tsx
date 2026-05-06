"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { Field } from "./Field";
import { FileUpload } from "./FileUpload";
import { getCategory, isMediaCategory, isVideoCategory } from "@/lib/categories";
import { extractApi, ApiError } from "@/lib/api-client";
import type { CategoryId } from "@/lib/types";
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
}

const EMPTY_FORM = {
  title: "", desc: "", tags: "", pinned: false,
  url: "", thumb: "", cover: "", duration: "", size: "", count: "", model: "",
};

export function AddItemModal({ categoryId, onClose, onSubmit }: Props) {
  const cat = getCategory(categoryId);
  const isVideo = isVideoCategory(categoryId);
  const isMedia = isMediaCategory(categoryId);
  const isWeb = categoryId === "web";
  const isDoc = categoryId === "documents";
  const isLocal = categoryId === "local";
  const isPrompt = categoryId === "prompts";
  const isImage = categoryId === "images";

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server rejects with 409 (unique content_hash hit).
  // The modal stays open and replaces the error banner with a CTA that
  // deep-links to the existing entry's category.
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  // og: extraction state — purely advisory UX feedback while the user
  // pastes a link.  The actual fetch happens via /api/extract.
  const [extracting, setExtracting] = useState(false);
  // For video category: until the URL is pasted (or the user clicks
  // "fill manually"), the form shows just one URL input.  Other fields
  // appear after extraction succeeds OR the user opts out of auto-fill.
  const [videoExpanded, setVideoExpanded] = useState(false);
  // Carry the extracted preview separately so the user can see what
  // was pulled even before deciding to edit.
  const [extractError, setExtractError] = useState<string | null>(null);
  // Chain-mode toast: title of the previous successfully-saved video,
  // shown above the URL field after submit so the user sees the cycle
  // worked before pasting the next link.
  const [lastSavedTitle, setLastSavedTitle] = useState<string | null>(null);
  // Number of entries saved in this modal session — only used to feed
  // the chain-mode toast / CTA.
  const [chainCount, setChainCount] = useState(0);
  const lastExtractedUrl = useRef<string>("");
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After a failed save (409 duplicate or any error) we remember the URL
  // that failed so close-with-pending doesn't loop into the same error
  // again.  Cleared whenever the user changes the URL.
  const failedUrl = useRef<string | null>(null);
  // Lets resetForNext() / chain-mode programmatically refocus the URL
  // input — autoFocus only fires on initial mount, not on form reset.
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
    const url = form.url.trim();
    // URL changed — clear the "this URL already failed to save" marker
    // so close-with-pending can try again on the new value.
    if (failedUrl.current && failedUrl.current !== url) failedUrl.current = null;
    if (!(isWeb || isVideo) || url.length < 8) return;
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    if (lastExtractedUrl.current === url) return;
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(async () => {
      lastExtractedUrl.current = url;
      setExtracting(true);
      setExtractError(null);
      try {
        const meta = await extractApi.fromUrl(url);
        if (!meta.hasContent) {
          if (isVideo) {
            setExtractError("Не удалось подтянуть данные. Заполни поля вручную.");
            setVideoExpanded(true);
          }
          return;
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
          return {
            ...f,
            title: f.title.trim() ? f.title : (meta.title ?? f.title),
            desc: f.desc.trim() ? f.desc : (videoDesc ?? f.desc),
            thumb: f.thumb.trim() ? f.thumb : (meta.image ?? f.thumb),
            cover: f.cover.trim() ? f.cover : (meta.image ?? f.cover),
            duration: f.duration.trim() ? f.duration : (meta.duration ?? f.duration),
            tags: f.tags.trim() ? f.tags : ((meta.tags ?? []).slice(0, 8).join(", ") || f.tags),
          };
        });
      } catch {
        // Silent — extraction is a nicety, not a feature.
        if (isVideo) {
          setExtractError("Сервис извлечения недоступен. Заполни поля вручную.");
          setVideoExpanded(true);
        }
      } finally {
        setExtracting(false);
      }
    }, 600);
    return () => {
      if (extractTimer.current) clearTimeout(extractTimer.current);
    };
  }, [form.url, isWeb, isVideo]);

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
    if (isVideo) {
      if (form.thumb.trim()) input.thumbUrl = form.thumb.trim();
      if (form.duration.trim()) input.duration = form.duration.trim();
      if (form.url.trim()) input.url = form.url.trim();
    }
    if (isMedia && form.cover.trim()) input.coverUrl = form.cover.trim();
    if (isImage && form.count) {
      const n = parseInt(form.count, 10);
      if (!isNaN(n)) input.fileCount = n;
    }
    if (isWeb && form.url.trim()) input.url = form.url.trim();
    if ((isDoc || isLocal) && form.size.trim()) input.sizeLabel = form.size.trim();
    if (isPrompt && form.model.trim()) input.metadata = { ...input.metadata, model: form.model.trim() };

    try {
      await onSubmit(input);
      return { ok: true, savedTitle: input.title };
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { existing?: DuplicateInfo } | null;
        if (body?.existing?.id) {
          setDuplicate(body.existing);
          failedUrl.current = form.url.trim() || null;
          return { ok: false };
        }
      }
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      failedUrl.current = form.url.trim() || null;
      return { ok: false };
    }
  };

  /**
   * Chain-mode reset: after a successful video save, clear the form
   * back to URL-only state so the user can paste the next link.  Keeps
   * the modal mounted and refocuses the URL input on next tick.  Used
   * by the submit handler when the category is video; non-video
   * categories close after submit as before.
   */
  const resetForNext = (savedTitle: string) => {
    setForm({ ...EMPTY_FORM });
    setVideoExpanded(false);
    setExtractError(null);
    setDuplicate(null);
    setError(null);
    lastExtractedUrl.current = "";
    failedUrl.current = null;
    setLastSavedTitle(savedTitle);
    setChainCount((n) => n + 1);
    // autoFocus only fires on initial mount — refocus by hand.
    setTimeout(() => urlInputRef.current?.focus(), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Double-submit guard — disabled buttons are easy to bypass with
    // Enter on the form, fast double-clicks, or touch double-taps.
    if (submitting) return;
    setError(null);
    setDuplicate(null);
    if (!form.title.trim()) return;
    setSubmitting(true);
    const result = await submitInput();
    setSubmitting(false);
    if (!result.ok) return;
    // Chain mode for video: keep the modal open and reset to URL-only
    // so the next paste continues the cycle.  All other categories
    // close on success — there's no "add another" affordance for
    // file-upload / model-picker / cover-picker forms.
    if (isVideo) {
      resetForNext(result.savedTitle ?? "");
    } else {
      onClose();
    }
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
    if (submitting) return;
    const pendingUrl = form.url.trim();
    const pendingTitle = form.title.trim();
    const hasPending =
      isVideo
      && !!pendingUrl
      && !!pendingTitle
      && !duplicate
      && !error
      && failedUrl.current !== pendingUrl;
    if (!hasPending) {
      onClose();
      return;
    }
    setSubmitting(true);
    const result = await submitInput();
    setSubmitting(false);
    if (result.ok) onClose();
    // On failure: banner is now visible, modal stays open.  User can
    // dismiss the banner and click Cancel again — second time we hit
    // the failedUrl guard above and just close.
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
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">
              {cat.ru}
              {isVideo && chainCount > 0 && (
                <span className="ml-2 text-emerald-300">· сохранено в этой сессии: {chainCount}</span>
              )}
            </div>
          </div>
          <button onClick={() => void requestClose()} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          {isVideo && !videoExpanded && lastSavedTitle && (
            <div className="mb-4 p-3 rounded-lg border border-emerald-300/40 bg-emerald-300/[0.06] flex items-start gap-3">
              <Icon name="check" size={14} className="text-emerald-300 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-300 mb-1">
                  Добавлено в базу
                </div>
                <div className="font-display text-[14px] font-medium leading-tight truncate">
                  «{lastSavedTitle}»
                </div>
                <div className="font-mono text-[10px] text-ivory-mute mt-1">
                  Вставь следующую ссылку или закрой окно — текущая черновая запись допишется сама.
                </div>
              </div>
            </div>
          )}
          {isVideo && (
            <Field
              label="Ссылка на видео"
              hint={
                extracting
                  ? "Тяну название, описание, превью, длительность и теги…"
                  : videoExpanded
                  ? "Поля ниже подтянулись автоматически — поправь, если что не так"
                  : lastSavedTitle
                  ? "Цепочка: вставь следующий URL или закрой — пендинг сохранится."
                  : "Вставь YouTube-ссылку. Название, описание, превью, длительность и теги заполнятся сами."
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

          {(!isVideo || videoExpanded) && (
            <>
              <Field label="Название" required>
                <input
                  autoFocus={!isVideo}
                  type="text"
                  className="field-input"
                  value={form.title}
                  onChange={set("title")}
                  placeholder={isVideo ? "Подтянется из YouTube — или впиши вручную" : "Краткий заголовок"}
                />
              </Field>

              <Field label="Описание">
                <textarea
                  className="field-textarea"
                  value={form.desc}
                  onChange={set("desc")}
                  placeholder={isVideo ? "Канал и заметки" : "Что это, зачем сохранил, ключевая мысль…"}
                />
              </Field>
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
                <input type="url" className="field-input" value={form.thumb} onChange={set("thumb")}
                  placeholder="https://images.unsplash.com/photo-... или /api/r2/object/..." />
              </Field>
              <Field label="Длительность">
                <input type="text" className="field-input" value={form.duration} onChange={set("duration")}
                  placeholder="12:34" />
              </Field>
            </>
          )}

          {isMedia && (
            <>
              <FileUpload
                kind="covers"
                accept="image/*"
                maxBytes={10 * 1024 * 1024}
                value={form.cover}
                onChange={(url) => setForm((f) => ({ ...f, cover: url }))}
                label="Обложка — загрузить"
                hint="WebP / JPEG / PNG · до 10 MB. Или вставь URL ниже."
              />
              <Field label="…или URL обложки">
                <input type="url" className="field-input" value={form.cover} onChange={set("cover")}
                  placeholder="https://images.unsplash.com/photo-..." />
              </Field>
            </>
          )}

          {isImage && (
            <Field label="Кол-во файлов в коллекции">
              <input type="number" min="1" className="field-input" value={form.count} onChange={set("count")} placeholder="12" />
            </Field>
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
              <select className="field-select" value={form.model} onChange={set("model")}>
                <option value="">— Не указано —</option>
                <option value="Opus 4.7">Claude Opus 4.7</option>
                <option value="Sonnet 4.6">Claude Sonnet 4.6</option>
                <option value="Haiku 4.5">Claude Haiku 4.5</option>
                <option value="GPT-5">GPT-5</option>
                <option value="Gemini 2.5">Gemini 2.5</option>
              </select>
            </Field>
          )}

          {(!isVideo || videoExpanded) && (
            <>
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
            <div className="mb-4 p-3 rounded-lg border border-gold/40 bg-gold/[0.06] flex items-start gap-3">
              <Icon name="check" size={14} className="text-gold mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
                  Уже сохранено · № {getCategory(duplicate.categoryId as CategoryId)?.no} · {getCategory(duplicate.categoryId as CategoryId)?.en}
                </div>
                <div className="font-display text-[15px] font-medium leading-tight truncate mb-2">
                  «{duplicate.title}»
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/category/${duplicate.categoryId}`}
                    onClick={onClose}
                    className="font-mono text-[10px] uppercase tracking-widest px-3 py-1 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
                  >
                    <Icon name="arrow" size={11} /> Открыть
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
              title={
                isVideo && form.url.trim() && form.title.trim()
                  ? "Сохранить пендинг и закрыть"
                  : "Закрыть"
              }
            >
              {isVideo && form.url.trim() && form.title.trim() ? "Сохранить и закрыть" : "Отмена"}
            </button>
            <button
              type="submit"
              disabled={titleDisabled}
              className="bg-ivory text-emerald-950 px-6 py-2.5 rounded-full font-medium tracking-tight hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
              title={isVideo ? "Сохранить и вставить следующую ссылку" : undefined}
            >
              <Icon name="add" size={16} /> {submitting ? "..." : isVideo ? "Добавить и продолжить" : cta}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
