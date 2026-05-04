"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Field } from "./Field";
import { FileUpload } from "./FileUpload";
import { getCategory, isMediaCategory, isVideoCategory } from "@/lib/categories";
import type { Entry } from "@/lib/types";
import type { UpdateEntryInput } from "@/lib/schemas/entries";

interface Props {
  entry: Entry;
  onClose: () => void;
  onSubmit: (id: string, input: UpdateEntryInput) => Promise<void>;
}

export function EditEntryModal({ entry, onClose, onSubmit }: Props) {
  const cat = getCategory(entry.categoryId);
  const isVideo = isVideoCategory(entry.categoryId);
  const isMedia = isMediaCategory(entry.categoryId);
  const isWeb = entry.categoryId === "web";
  const isDoc = entry.categoryId === "documents";
  const isLocal = entry.categoryId === "local";
  const isPrompt = entry.categoryId === "prompts";
  const isImage = entry.categoryId === "images";

  const [form, setForm] = useState({
    title: entry.title,
    desc: entry.description ?? "",
    tags: entry.tags.join(", "),
    pinned: entry.pinned,
    url: entry.url ?? "",
    thumb: entry.thumbUrl ?? "",
    cover: entry.coverUrl ?? "",
    duration: entry.duration ?? "",
    size: entry.sizeLabel ?? "",
    count: entry.fileCount?.toString() ?? "",
    model: (entry.metadata?.model as string) ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const target = e.target as HTMLInputElement;
      setForm({ ...form, [k]: target.type === "checkbox" ? target.checked : target.value });
    };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const patch: UpdateEntryInput = {
        title: form.title.trim(),
        description: form.desc.trim() || null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        pinned: form.pinned,
      };
      if (isVideo) {
        patch.thumbUrl = form.thumb.trim() || null;
        patch.duration = form.duration.trim() || null;
      }
      if (isMedia) patch.coverUrl = form.cover.trim() || null;
      if (isImage) {
        const n = form.count ? parseInt(form.count, 10) : null;
        patch.fileCount = isNaN(n as number) ? null : n;
      }
      if (isWeb || isDoc || isLocal) patch.url = form.url.trim() || null;
      if (isDoc || isLocal) patch.sizeLabel = form.size.trim() || null;
      if (isPrompt) {
        patch.metadata = { ...entry.metadata, model: form.model.trim() || undefined };
      }

      await onSubmit(entry.id, patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setSubmitting(false);
    }
  };

  if (!cat) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between p-7 pb-5 border-b border-white/10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">
              № {cat.no} · {cat.en} · Edit
            </div>
            <h3 className="font-display text-[32px] font-medium leading-none">Редактировать</h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2 truncate max-w-md">
              {entry.title}
            </div>
          </div>
          <button onClick={onClose} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          <Field label="Название" required>
            <input autoFocus type="text" className="field-input" value={form.title} onChange={set("title")} />
          </Field>

          <Field label="Описание">
            <textarea className="field-textarea" value={form.desc} onChange={set("desc")} />
          </Field>

          {isVideo && (
            <>
              <FileUpload kind="thumbs" accept="image/*" maxBytes={5 * 1024 * 1024}
                value={form.thumb} onChange={(url) => setForm((f) => ({ ...f, thumb: url }))}
                label="Превью видео" hint="WebP / JPEG / PNG · до 5 MB" />
              <Field label="…или URL превью">
                <input type="url" className="field-input" value={form.thumb} onChange={set("thumb")} />
              </Field>
              <Field label="Длительность">
                <input type="text" className="field-input" value={form.duration} onChange={set("duration")} placeholder="12:34" />
              </Field>
            </>
          )}

          {isMedia && (
            <>
              <FileUpload kind="covers" accept="image/*" maxBytes={10 * 1024 * 1024}
                value={form.cover} onChange={(url) => setForm((f) => ({ ...f, cover: url }))}
                label="Обложка" hint="WebP / JPEG / PNG · до 10 MB" />
              <Field label="…или URL обложки">
                <input type="url" className="field-input" value={form.cover} onChange={set("cover")} />
              </Field>
            </>
          )}

          {isImage && (
            <Field label="Кол-во файлов">
              <input type="number" min="0" className="field-input" value={form.count} onChange={set("count")} />
            </Field>
          )}

          {isWeb && (
            <Field label="URL ресурса">
              <input type="url" className="field-input" value={form.url} onChange={set("url")} />
            </Field>
          )}

          {(isDoc || isLocal) && (
            <>
              <FileUpload kind="originals" maxBytes={100 * 1024 * 1024}
                value={form.url} onChange={(url) => setForm((f) => ({ ...f, url }))}
                label="Файл" hint="PDF / DOCX / ZIP / video / audio / image · до 100 MB" />
              <Field label="Размер (display)">
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

          <Field label="Теги (через запятую)">
            <input type="text" className="field-input" value={form.tags} onChange={set("tags")} placeholder="tag1, tag2" />
          </Field>

          <label className="flex items-center gap-3 mt-2 mb-6 cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={form.pinned} onChange={set("pinned")} />
            <span className="text-[13px] text-ivory-dim flex items-center gap-1.5">
              <Icon name="pin" size={13} className="text-gold" /> Закрепить наверху
            </span>
          </label>

          {error && (
            <div className="mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
              <Icon name="x" size={12} /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-5 border-t border-white/10 -mx-7 px-7">
            <button type="button" onClick={onClose}
              className="border border-white/20 text-ivory-dim px-5 py-2.5 rounded-full font-medium hover:border-white/40 hover:text-ivory transition">
              Отмена
            </button>
            <button type="submit" disabled={!form.title.trim() || submitting}
              className="bg-ivory text-emerald-950 px-6 py-2.5 rounded-full font-medium hover:bg-emerald-100 disabled:opacity-40 transition flex items-center gap-2">
              <Icon name="check" size={16} /> {submitting ? "..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
