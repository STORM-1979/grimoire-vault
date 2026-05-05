"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext, DragEndEvent, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  rectSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@/components/icons/Icon";
import { attachmentsApi, extractApi } from "@/lib/api-client";
import { uploadToR2 } from "@/lib/upload";
import type { Entry, EntryAttachment, AttachmentKind } from "@/lib/types";

/**
 * The interactive board: drag-and-drop ordered list of attached
 * blocks (image / video / link / note / file).  Add via the toolbar
 * at top, drag to reorder, click trash on hover to delete.
 *
 * Uploads (image / file) go straight to R2 via the same presigned-PUT
 * path as covers/thumbs on the parent entry; links auto-fetch og:meta
 * via /api/extract; notes are inline-edited.
 */
export function EntryBoard({ entry, initial }: { entry: Entry; initial: EntryAttachment[] }) {
  const [items, setItems] = useState<EntryAttachment[]>(initial);
  const [busy, setBusy] = useState<null | AttachmentKind | "reorder" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const refresh = useCallback(async () => {
    const r = await attachmentsApi.list(entry.id);
    setItems(r.items);
  }, [entry.id]);

  // ---- ADD: image / file via R2 upload ---------------------------------
  const addUpload = async (kind: "image" | "file", file: File) => {
    setBusy(kind);
    setError(null);
    try {
      // Reuse existing R2 helper.  WebP transcode happens automatically
      // for JPEG/PNG inside `uploadToR2`.
      const r = await uploadToR2(file, kind === "image" ? "covers" : "originals");
      await attachmentsApi.create(entry.id, {
        kind,
        url: r.publicUrl,
        caption: file.name.replace(/\.[^.]+$/, "").slice(0, 200),
        metadata: { size: r.size, contentType: r.contentType },
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  // ---- ADD: video / link via URL --------------------------------------
  const addUrl = async (kind: "video" | "link", url: string) => {
    if (!url.trim()) return;
    setBusy(kind);
    setError(null);
    try {
      // og: extract for both — gives us a thumbnail + title for free.
      let caption: string | undefined;
      let body: string | undefined;
      let thumbUrl: string | undefined;
      try {
        const meta = await extractApi.fromUrl(url);
        if (meta.hasContent) {
          caption = meta.title?.slice(0, 280);
          body = meta.description?.slice(0, 2000);
          thumbUrl = meta.image ?? undefined;
        }
      } catch { /* extraction is best-effort */ }
      await attachmentsApi.create(entry.id, {
        kind, url,
        caption: caption ?? null,
        body: kind === "link" ? (body ?? null) : undefined as never,
        thumbUrl: thumbUrl ?? null,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(null);
    }
  };

  // ---- ADD: note ------------------------------------------------------
  const addNote = async () => {
    setBusy("note");
    setError(null);
    try {
      await attachmentsApi.create(entry.id, {
        kind: "note",
        body: "Новая заметка",
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(null);
    }
  };

  // ---- DELETE ---------------------------------------------------------
  const remove = async (id: string) => {
    if (!confirm("Удалить блок с доски?")) return;
    setBusy("delete");
    const snapshot = items;
    setItems((prev) => prev.filter((it) => it.id !== id));
    try {
      await attachmentsApi.delete(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setItems(snapshot);
    } finally {
      setBusy(null);
    }
  };

  // ---- EDIT note / caption inline -------------------------------------
  const updateField = useCallback(async (id: string, patch: { caption?: string; body?: string }) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it));
    try {
      await attachmentsApi.update(id, patch);
    } catch (e) {
      console.warn("[board] update failed", e);
    }
  }, []);

  // ---- REORDER --------------------------------------------------------
  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((it) => it.id === active.id);
    const newIdx = items.findIndex((it) => it.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(items, oldIdx, newIdx);
    setItems(reordered);
    setBusy("reorder");
    try {
      await attachmentsApi.reorder(entry.id, reordered.map((it) => it.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed");
    } finally {
      setBusy(null);
    }
  };

  const ids = useMemo(() => items.map((it) => it.id), [items]);

  return (
    <section className="max-w-[1080px] mx-auto px-10 py-10">
      <Toolbar busy={busy} onUpload={addUpload} onUrl={addUrl} onNote={addNote} />

      {error && (
        <div className="mt-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                {items.map((a) => (
                  <SortableCard key={a.id} att={a} onDelete={remove} onUpdate={updateField} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}

/* -------------------- Toolbar -------------------- */

function Toolbar({
  busy,
  onUpload,
  onUrl,
  onNote,
}: {
  busy: string | null;
  onUpload: (kind: "image" | "file", file: File) => Promise<void>;
  onUrl: (kind: "video" | "link", url: string) => Promise<void>;
  onNote: () => Promise<void>;
}) {
  const [urlOpen, setUrlOpen] = useState<null | "video" | "link">(null);
  const [urlDraft, setUrlDraft] = useState("");

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mr-1">
        Доска ·
      </span>

      {/* Image upload */}
      <label className={btnPrimary(busy === "image")}>
        <Icon name="images" size={13} /> {busy === "image" ? "Загружаю…" : "Картинка"}
        <input
          type="file" accept="image/*" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload("image", f);
            e.currentTarget.value = "";
          }}
        />
      </label>

      {/* Video URL */}
      {urlOpen === "video" ? (
        <UrlPopover
          placeholder="YouTube / Vimeo / mp4 URL"
          busy={busy === "video"}
          value={urlDraft}
          onChange={setUrlDraft}
          onSubmit={async () => {
            await onUrl("video", urlDraft);
            setUrlDraft("");
            setUrlOpen(null);
          }}
          onCancel={() => { setUrlOpen(null); setUrlDraft(""); }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setUrlOpen("video")}
          className={btnSecondary()}
        >
          <Icon name="play" size={13} /> Видео
        </button>
      )}

      {/* Link URL */}
      {urlOpen === "link" ? (
        <UrlPopover
          placeholder="https://example.com — подтянем заголовок"
          busy={busy === "link"}
          value={urlDraft}
          onChange={setUrlDraft}
          onSubmit={async () => {
            await onUrl("link", urlDraft);
            setUrlDraft("");
            setUrlOpen(null);
          }}
          onCancel={() => { setUrlOpen(null); setUrlDraft(""); }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setUrlOpen("link")}
          className={btnSecondary()}
        >
          <Icon name="web" size={13} /> Ссылка
        </button>
      )}

      {/* File upload */}
      <label className={btnSecondary()}>
        <Icon name="documents" size={13} /> {busy === "file" ? "Загружаю…" : "Файл"}
        <input
          type="file" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onUpload("file", f);
            e.currentTarget.value = "";
          }}
        />
      </label>

      {/* Note */}
      <button
        type="button"
        onClick={onNote}
        disabled={busy === "note"}
        className={btnSecondary()}
      >
        <Icon name="prompts" size={13} /> {busy === "note" ? "…" : "Заметка"}
      </button>
    </div>
  );
}

function UrlPopover({
  placeholder, busy, value, onChange, onSubmit, onCancel,
}: {
  placeholder: string;
  busy: boolean;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-white/5 border border-gold/30 rounded-full pl-3 pr-1 py-1">
      <input
        autoFocus
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void onSubmit(); }
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className="bg-transparent outline-none text-[12px] text-ivory placeholder:text-ivory-mute/50 w-72"
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim() || busy}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1 rounded-full bg-gold text-emerald-deep disabled:opacity-50"
      >
        {busy ? "…" : "+"}
      </button>
      <button
        onClick={onCancel}
        className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-full text-ivory-mute hover:text-ivory transition"
      >
        ✕
      </button>
    </div>
  );
}

function btnPrimary(active: boolean): string {
  return `font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition flex items-center gap-1.5 cursor-pointer ${
    active
      ? "bg-gold/40 text-emerald-deep"
      : "bg-ivory text-emerald-950 hover:bg-emerald-100"
  }`;
}
function btnSecondary(): string {
  return `font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition flex items-center gap-1.5 cursor-pointer`;
}

/* -------------------- SortableCard -------------------- */

function SortableCard({
  att,
  onDelete,
  onUpdate,
}: {
  att: EntryAttachment;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: { caption?: string; body?: string }) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: att.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative keynote rounded-xl overflow-hidden border border-white/10 hover:border-gold/40 transition"
    >
      {/* Drag handle (top-left, hover-visible) */}
      <button
        {...attributes}
        {...listeners}
        type="button"
        title="Перетащить"
        className="absolute top-2 left-2 z-10 w-7 h-7 rounded-full bg-emerald-deep/80 backdrop-blur border border-white/15 text-ivory-mute hover:text-gold opacity-0 group-hover:opacity-100 transition flex items-center justify-center cursor-grab active:cursor-grabbing"
      >
        <Icon name="drag" size={12} />
      </button>

      {/* Delete (top-right, hover-visible) */}
      <button
        type="button"
        onClick={() => onDelete(att.id)}
        title="Удалить"
        className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-emerald-deep/80 backdrop-blur border border-red-400/40 text-red-300 hover:bg-red-400 hover:text-emerald-deep opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
      >
        <Icon name="x" size={12} />
      </button>

      <CardBody att={att} onUpdate={onUpdate} />
    </div>
  );
}

/* -------------------- Card body — kind-specific render ----- */

function CardBody({
  att,
  onUpdate,
}: {
  att: EntryAttachment;
  onUpdate: (id: string, patch: { caption?: string; body?: string }) => void;
}) {
  if (att.kind === "image") {
    return (
      <div className="flex flex-col">
        {att.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={att.url}
            alt={att.caption ?? ""}
            loading="lazy"
            className="w-full aspect-[4/3] object-cover bg-white/5"
          />
        )}
        <EditableCaption att={att} onUpdate={onUpdate} placeholder="Подпись (необязательно)" />
      </div>
    );
  }

  if (att.kind === "video") {
    const embed = att.url ? toVideoEmbed(att.url) : null;
    return (
      <div className="flex flex-col">
        {embed ? (
          embed.kind === "iframe" ? (
            <div className="w-full aspect-video bg-black">
              <iframe
                src={embed.src}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                title={att.caption ?? "Видео"}
              />
            </div>
          ) : (
            <video src={embed.src} controls className="w-full aspect-video bg-black" />
          )
        ) : (
          <div className="w-full aspect-video bg-white/5 flex items-center justify-center text-ivory-mute font-mono text-[11px]">
            Не удалось встроить
          </div>
        )}
        <EditableCaption att={att} onUpdate={onUpdate} placeholder="Подпись (необязательно)" />
      </div>
    );
  }

  if (att.kind === "link") {
    return (
      <a
        href={att.url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col h-full hover:bg-white/[0.03] transition"
      >
        {att.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={att.thumbUrl}
            alt=""
            loading="lazy"
            className="w-full aspect-[16/9] object-cover bg-white/5"
          />
        ) : (
          <div className="w-full aspect-[16/9] bg-emerald-deep/40 flex items-center justify-center">
            <Icon name="web" size={28} className="text-gold/50" />
          </div>
        )}
        <div className="p-4 flex-1 flex flex-col">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gold mb-1 truncate">
            {att.url ? new URL(att.url).hostname.replace(/^www\./, "") : ""}
          </div>
          <div className="font-display text-[15px] font-medium leading-snug text-ivory line-clamp-2">
            {att.caption ?? att.url}
          </div>
          {att.body && (
            <p className="text-[12.5px] text-ivory-dim font-light mt-1 line-clamp-3">{att.body}</p>
          )}
        </div>
      </a>
    );
  }

  if (att.kind === "file") {
    return (
      <a
        href={att.url ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-4 p-5 hover:bg-white/[0.03] transition h-full"
      >
        <div className="w-12 h-12 rounded-lg bg-emerald-deep/60 border border-gold/30 flex items-center justify-center flex-shrink-0">
          <Icon name="documents" size={22} className="text-gold" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-[15px] font-medium leading-tight truncate">
            {att.caption ?? "Файл"}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1">
            {(att.metadata?.contentType as string) ?? "файл"}
            {att.metadata?.size ? ` · ${humanSize(att.metadata.size as number)}` : ""}
          </div>
        </div>
        <Icon name="arrow" size={14} className="text-gold flex-shrink-0" />
      </a>
    );
  }

  // note
  return (
    <div className="p-5 h-full flex flex-col">
      <div className="font-mono text-[9px] uppercase tracking-widest text-gold mb-2">Заметка</div>
      <EditableBody att={att} onUpdate={onUpdate} />
    </div>
  );
}

/* -------------------- Inline editors -------------------- */

function EditableCaption({
  att, onUpdate, placeholder,
}: {
  att: EntryAttachment;
  onUpdate: (id: string, patch: { caption?: string }) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(att.caption ?? "");
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== (att.caption ?? "")) onUpdate(att.id, { caption: draft }); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder={placeholder}
      className="px-4 py-3 bg-transparent outline-none text-[13px] text-ivory placeholder:text-ivory-mute/50 border-t border-white/8"
    />
  );
}

function EditableBody({
  att, onUpdate,
}: {
  att: EntryAttachment;
  onUpdate: (id: string, patch: { body?: string }) => void;
}) {
  const [draft, setDraft] = useState(att.body ?? "");
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== (att.body ?? "")) onUpdate(att.id, { body: draft }); }}
      placeholder="Текст заметки…"
      rows={6}
      className="flex-1 bg-transparent outline-none text-[13.5px] text-ivory placeholder:text-ivory-mute/50 resize-none leading-relaxed"
    />
  );
}

/* -------------------- Helpers -------------------- */

function EmptyState() {
  return (
    <div className="text-center py-16 border border-dashed border-white/10 rounded-2xl">
      <div className="text-ivory-mute font-light italic mb-3">— доска пуста —</div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
        Прикрепи картинку, видео, ссылку или заметку через тулбар
      </div>
    </div>
  );
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Recognise YouTube / Vimeo / direct-video URLs and produce an embed.
 * Other URLs fall back to "Не удалось встроить" — typically those
 * should be saved as `link` kind, not `video`.
 */
function toVideoEmbed(url: string): { kind: "iframe" | "video"; src: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");

  // YouTube — watch?v= / youtu.be / shorts/<id> / embed/<id>
  let ytId: string | null = null;
  if (host === "youtube.com" || host === "m.youtube.com") {
    ytId = u.searchParams.get("v");
    if (!ytId) {
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
      if (m) ytId = m[1];
    }
  } else if (host === "youtu.be") {
    const m = u.pathname.match(/^\/([\w-]{11})/);
    if (m) ytId = m[1];
  }
  if (ytId) return { kind: "iframe", src: `https://www.youtube.com/embed/${ytId}` };

  // Vimeo — /<id>
  if (host === "vimeo.com") {
    const m = u.pathname.match(/^\/(\d+)/);
    if (m) return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}` };
  }

  // Direct video file
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) {
    return { kind: "video", src: url };
  }

  return null;
}
