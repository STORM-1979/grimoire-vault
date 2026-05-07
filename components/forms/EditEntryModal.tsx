"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Field } from "./Field";
import { FileUpload } from "./FileUpload";
import { CollectionSelect } from "./CollectionSelect";
import { ThemedSelect } from "./ThemedSelect";
import { getCategory, isMediaCategory, isVideoCategory } from "@/lib/categories";
import { humanSize } from "@/lib/utils";
import type { Entry, EntryCollection } from "@/lib/types";
import type { UpdateEntryInput } from "@/lib/schemas/entries";

interface Props {
  entry: Entry;
  onClose: () => void;
  onSubmit: (id: string, input: UpdateEntryInput) => Promise<void>;
  /** User-defined collections in this entry's category — drives the
   * "Коллекция" picker for video entries.  Omit / empty array hides
   * the picker. */
  collections?: EntryCollection[];
}

export function EditEntryModal({ entry, onClose, onSubmit, collections }: Props) {
  const cat = getCategory(entry.categoryId);
  const isVideo = isVideoCategory(entry.categoryId);
  const isMedia = isMediaCategory(entry.categoryId);
  const isDesign = entry.categoryId === "designs";
  const isWeb = entry.categoryId === "web";
  const isDoc = entry.categoryId === "documents";
  const isLocal = entry.categoryId === "local";
  const isPrompt = entry.categoryId === "prompts";
  const isImage = entry.categoryId === "images";
  const isPortfolio = entry.categoryId === "portfolio";

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
    // Portfolio project links — read from existing metadata so the
    // form pre-populates with whatever was saved at create time.
    vercelUrl: (entry.metadata?.vercelUrl as string) ?? "",
    gitUrl: (entry.metadata?.gitUrl as string) ?? "",
    dbUrl: (entry.metadata?.dbUrl as string) ?? "",
  });
  // Bytes of a freshly re-uploaded cover (post-compression).  Only
  // set when the user replaces the existing image — null means "no
  // change, keep whatever the entry already has".
  const [coverBytes, setCoverBytes] = useState<number | null>(null);
  // Collection assignment lives outside `form` because it's only
  // present for video entries with collections loaded.
  const [collectionId, setCollectionId] = useState<string | null>(entry.collectionId ?? null);
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
      // Collection patch flows for every collectable category.
      // Explicit null is the wire format for "remove from current
      // collection / move to category root" — letting null pass
      // through is intentional.
      if (collections && collections.length > 0) {
        patch.collectionId = collectionId;
      }
      if (isMedia) patch.coverUrl = form.cover.trim() || null;
      // Update the cached weight only on a fresh upload — same
      // skip-for-designs reason as in AddItemModal.
      if (isMedia && !isDesign && coverBytes !== null) {
        patch.sizeBytes = coverBytes;
        patch.sizeLabel = humanSize(coverBytes);
      }
      if (isImage) {
        const n = form.count ? parseInt(form.count, 10) : null;
        patch.fileCount = isNaN(n as number) ? null : n;
      }
      if (isWeb || isDoc || isLocal || isDesign) patch.url = form.url.trim() || null;
      if (isDoc || isLocal) patch.sizeLabel = form.size.trim() || null;
      if (isPrompt) {
        patch.metadata = { ...entry.metadata, model: form.model.trim() || undefined };
      }
      // Portfolio project links — overwrite previous values on every
      // save so cleared fields actually clear (undefined → key is
      // dropped from the merged metadata object).
      if (isPortfolio) {
        patch.metadata = {
          ...entry.metadata,
          vercelUrl: form.vercelUrl.trim() || undefined,
          gitUrl:    form.gitUrl.trim()    || undefined,
          dbUrl:     form.dbUrl.trim()     || undefined,
        };
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
                {/* type="text" — accepts our internal /api/r2/* paths
                    (HTML5 url validation rejects relative URLs). */}
                <input type="text" className="field-input" value={form.thumb} onChange={set("thumb")} />
              </Field>
              <Field label="Длительность">
                <input type="text" className="field-input" value={form.duration} onChange={set("duration")} placeholder="12:34" />
              </Field>
            </>
          )}

          {isDesign && (
            <Field label="Ссылка на сайт / страницу">
              <input
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
              <FileUpload kind="covers" accept="image/*" maxBytes={10 * 1024 * 1024}
                value={form.cover} onChange={(url) => setForm((f) => ({ ...f, cover: url }))}
                onMeta={(meta) => setCoverBytes(meta.size)}
                label="Обложка" hint="WebP / JPEG / PNG · до 10 MB" />
              <Field label="…или URL обложки">
                {/* See note on the thumb field — same reason. */}
                <input type="text" className="field-input" value={form.cover} onChange={set("cover")} />
              </Field>
            </>
          )}

          {isImage && (
            <Field label="Кол-во файлов">
              <input type="number" min="0" className="field-input" value={form.count} onChange={set("count")} />
            </Field>
          )}

          {isPortfolio && (
            <>
              <Field label="Vercel / прод-ссылка">
                <input type="text" className="field-input" value={form.vercelUrl} onChange={set("vercelUrl")} placeholder="https://my-project.vercel.app" />
              </Field>
              <Field label="GitHub / репозиторий">
                <input type="text" className="field-input" value={form.gitUrl} onChange={set("gitUrl")} placeholder="https://github.com/me/project" />
              </Field>
              <Field label="БД / админ-панель">
                <input type="text" className="field-input" value={form.dbUrl} onChange={set("dbUrl")} placeholder="https://supabase.com/dashboard/project/…" />
              </Field>
            </>
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
              <ThemedSelect
                options={[
                  { value: "Opus 4.7", label: "Claude Opus 4.7" },
                  { value: "Sonnet 4.6", label: "Claude Sonnet 4.6" },
                  { value: "Haiku 4.5", label: "Claude Haiku 4.5" },
                  { value: "GPT-5", label: "GPT-5" },
                  { value: "Gemini 2.5", label: "Gemini 2.5" },
                ]}
                value={form.model}
                onChange={(v) => setForm({ ...form, model: v })}
              />
            </Field>
          )}

          {collections && collections.length > 0 && (
            <Field label="Коллекция" hint="Перенести запись в другую коллекцию или вынести в корень категории">
              <CollectionSelect
                collections={collections}
                value={collectionId}
                onChange={setCollectionId}
              />
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
