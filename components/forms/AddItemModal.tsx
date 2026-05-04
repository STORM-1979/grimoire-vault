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

export function AddItemModal({ categoryId, onClose, onSubmit }: Props) {
  const cat = getCategory(categoryId);
  const isVideo = isVideoCategory(categoryId);
  const isMedia = isMediaCategory(categoryId);
  const isWeb = categoryId === "web";
  const isDoc = categoryId === "documents";
  const isLocal = categoryId === "local";
  const isPrompt = categoryId === "prompts";
  const isImage = categoryId === "images";

  const [form, setForm] = useState({
    title: "", desc: "", tags: "", pinned: false,
    url: "", thumb: "", cover: "", duration: "", size: "", count: "", model: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server rejects with 409 (unique content_hash hit).
  // The modal stays open and replaces the error banner with a CTA that
  // deep-links to the existing entry's category.
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  // og: extraction state — purely advisory UX feedback while the user
  // pastes a link.  The actual fetch happens via /api/extract.
  const [extracting, setExtracting] = useState(false);
  const lastExtractedUrl = useRef<string>("");
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: (e.target as HTMLInputElement).type === "checkbox"
        ? (e.target as HTMLInputElement).checked
        : e.target.value });

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-extract og: meta when the URL field becomes a real URL.
  // Only fills *empty* fields — the user's typing always wins.
  useEffect(() => {
    const url = form.url.trim();
    if (!isWeb || url.length < 8) return;
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    if (lastExtractedUrl.current === url) return;
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(async () => {
      lastExtractedUrl.current = url;
      setExtracting(true);
      try {
        const meta = await extractApi.fromUrl(url);
        if (!meta.hasContent) return;
        setForm((f) => ({
          ...f,
          title: f.title.trim() ? f.title : (meta.title ?? f.title),
          desc: f.desc.trim() ? f.desc : (meta.description ?? f.desc),
          thumb: f.thumb.trim() ? f.thumb : (meta.image ?? f.thumb),
          cover: f.cover.trim() ? f.cover : (meta.image ?? f.cover),
        }));
      } catch {
        // Silent — extraction is a nicety, not a feature.
      } finally {
        setExtracting(false);
      }
    }, 600);
    return () => {
      if (extractTimer.current) clearTimeout(extractTimer.current);
    };
  }, [form.url, isWeb]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDuplicate(null);
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
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
      }
      if (isMedia && form.cover.trim()) input.coverUrl = form.cover.trim();
      if (isImage && form.count) {
        const n = parseInt(form.count, 10);
        if (!isNaN(n)) input.fileCount = n;
      }
      if (isWeb && form.url.trim()) input.url = form.url.trim();
      if ((isDoc || isLocal) && form.size.trim()) input.sizeLabel = form.size.trim();
      if (isPrompt && form.model.trim()) input.metadata = { ...input.metadata, model: form.model.trim() };

      await onSubmit(input);
      onClose();
    } catch (err) {
      // 409 with `existing` payload → soft conflict: show a CTA that
      // deep-links to the duplicate instead of the raw error string.
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { existing?: DuplicateInfo } | null;
        if (body?.existing?.id) {
          setDuplicate(body.existing);
          setSubmitting(false);
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setSubmitting(false);
    }
  };

  if (!cat) return null;

  const cta = isVideo ? "Добавить видео"
    : isMedia ? "Добавить превью"
    : isWeb ? "Добавить ссылку"
    : isDoc ? "Добавить документ"
    : isPrompt ? "Добавить промпт"
    : "Добавить запись";

  const titleDisabled = !form.title.trim() || submitting;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between p-7 pb-5 border-b border-white/10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">№ {cat.no} · {cat.en}</div>
            <h3 className="font-display text-[32px] font-medium leading-none">{cta}</h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">{cat.ru}</div>
          </div>
          <button onClick={onClose} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          <Field label="Название" required>
            <input
              autoFocus
              type="text"
              className="field-input"
              value={form.title}
              onChange={set("title")}
              placeholder={isVideo ? "Например: Theo - обзор Next.js 16" : "Краткий заголовок"}
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

          {isVideo && (
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
                hint="PDF / DOCX / ZIP / video / audio / image · до 100 MB"
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
              onClick={onClose}
              className="border border-white/20 text-ivory-dim px-5 py-2.5 rounded-full font-medium tracking-tight hover:border-white/40 hover:text-ivory transition"
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
