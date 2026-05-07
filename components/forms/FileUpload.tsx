"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { humanFileSize, uploadToR2, type UploadKind, type UploadProgress } from "@/lib/upload";
import { compressImage } from "@/lib/image-compress";

/**
 * Metadata about the picked file.  Surfaced BEFORE the upload starts so
 * the parent form can pre-fill title / size fields even if the upload
 * itself fails (e.g. unsupported MIME) — that way the user doesn't have
 * to retype after fixing the issue.
 */
export interface FileMeta {
  name: string;
  size: number;
  type: string;
  /** Best-effort document title: PDF /Title metadata, or cleaned filename. */
  suggestedTitle?: string;
}

interface FileUploadProps {
  /** Storage tier on R2 */
  kind: UploadKind;
  /** MIME-type filter for the native file picker */
  accept?: string;
  /** Optional max-size override (display only — server enforces actual limit) */
  maxBytes?: number;
  /** Current value: an /api/r2/object/... URL or empty */
  value: string;
  /** Called with the new public URL once upload finishes */
  onChange: (url: string) => void;
  /** Optional: receives metadata about the selected file before upload */
  onMeta?: (meta: FileMeta) => void;
  label?: string;
  hint?: string;
}

export function FileUpload({
  kind, accept, maxBytes, value, onChange, onMeta, label = "Файл", hint,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [compressing, setCompressing] = useState(false);

  const handleFile = async (rawFile: File | null) => {
    if (!rawFile) return;
    setError(null);

    // Step 1: client-side image compression.  Always re-encode raster
    // images (JPEG/PNG/BMP/TIFF) to WebP — even tiny screenshots
    // typically shrink 50–70 %, and the compressor returns the
    // original if its output ends up bigger.  Already-WebP/AVIF/GIF/
    // SVG inputs are skipped inside `compressImage`.  Detection is
    // MIME-first with extension fallback for empty / generic types.
    let file = rawFile;
    const looksLikeImage =
      /^image\/(jpeg|png|webp|avif|bmp|tiff|heic|heif|gif|svg)/i.test(rawFile.type) ||
      /\.(jpe?g|png|webp|avif|bmp|tiff?|heic|heif|gif|svg)$/i.test(rawFile.name);
    if (looksLikeImage) {
      setCompressing(true);
      try {
        file = await compressImage(rawFile, {
          targetBytes: maxBytes ?? undefined,
        });
      } catch (e) {
        // HEIC / corrupt / unsupported formats end up here. If the
        // file was within the cap to begin with, fall through and
        // upload the original.  Otherwise tell the user explicitly
        // so they can convert and retry instead of bouncing off the
        // generic size-cap banner.
        if (maxBytes && rawFile.size > maxBytes) {
          const reason = e instanceof Error ? e.message : "decode failed";
          const isHeic = /heic|heif/i.test(rawFile.type) || /\.(heic|heif)$/i.test(rawFile.name);
          setCompressing(false);
          setError(
            isHeic
              ? "HEIC не поддерживается браузером — сохрани как JPEG или PNG."
              : `Не удалось сжать изображение: ${reason}. Уменьши вручную и загрузи снова.`,
          );
          return;
        }
        // Within-cap decode failure → ship the original bytes.
        file = rawFile;
      } finally {
        setCompressing(false);
      }
    }

    if (maxBytes && file.size > maxBytes) {
      setError(
        looksLikeImage
          ? `Не удалось ужать ниже ${humanFileSize(maxBytes)} (получилось ${humanFileSize(file.size)}). Возьми меньшее изображение.`
          : `Файл больше ${humanFileSize(maxBytes)}`,
      );
      return;
    }
    // Surface metadata before the network call so the parent can
    // pre-fill title/size even if R2 rejects the MIME later.  Title
    // extraction from PDF metadata is best-effort; fallback is the
    // cleaned filename.
    if (onMeta) {
      const suggestedTitle = await suggestTitle(file);
      onMeta({ name: file.name, size: file.size, type: file.type, suggestedTitle });
    }
    setBusy(true);
    setProgress({ loaded: 0, total: file.size, percent: 0 });
    try {
      const res = await uploadToR2(file, kind, setProgress);
      onChange(res.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(null), 800);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => handleFile(e.target.files?.[0] ?? null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0] ?? null);
  };

  const fileLabel = kind === "thumbs" ? "превью видео" : kind === "covers" ? "обложку" : "файл";

  // NOTE: this used to be a <label> wrapping everything.  HTML labels
  // with a nested form control auto-forward clicks to that control —
  // which meant clicking ANYWHERE inside this widget (preview image,
  // "Удалить" button, even the heading) re-opened the OS file picker.
  // A plain <div> root removes that surprise; the explicit "click drop
  // zone / click Заменить" handlers are the only ways to open the
  // picker now.
  return (
    <div className="block mb-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">{label}</div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onPick}
        className="hidden"
      />

      {value ? (
        <div className="relative">
          {/* Show preview if it's an image-y URL */}
          {/^(https?:|\/api\/r2\/)/.test(value) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              loading="lazy"
              className="w-full h-32 object-cover rounded-lg border border-gold/20"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0"; }}
            />
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex-1 border border-white/20 text-ivory-dim px-3 py-2 rounded-lg font-mono text-[10px] uppercase tracking-widest hover:border-gold hover:text-gold transition flex items-center justify-center gap-1.5"
            >
              <Icon name="refresh" size={12} /> Заменить
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              className="border border-white/20 text-ivory-dim px-3 py-2 rounded-lg font-mono text-[10px] uppercase tracking-widest hover:border-red-400 hover:text-red-400 transition flex items-center justify-center gap-1.5"
            >
              <Icon name="x" size={12} /> Удалить
            </button>
          </div>
          <div className="font-mono text-[10px] text-ivory-mute/70 mt-1 truncate">{value}</div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          className={`relative cursor-pointer rounded-lg border-2 border-dashed transition px-4 py-8 text-center select-none ${
            dragOver ? "border-gold bg-gold/[0.06]" : "border-gold/30 hover:border-gold/60 hover:bg-white/[0.03]"
          } ${busy ? "pointer-events-none opacity-70" : ""}`}
        >
          <Icon name="add" size={22} className="mx-auto text-gold mb-2" />
          <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
            {compressing
              ? "Сжимаю…"
              : busy
              ? "Загружаю…"
              : `Перетащи ${fileLabel} или кликни`}
          </div>
          {hint && !busy && !compressing && (
            <div className="font-mono text-[10px] text-ivory-mute/70 mt-2">{hint}</div>
          )}
        </div>
      )}

      {progress && (
        <div className="mt-2">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gold transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">
            {progress.percent}% · {humanFileSize(progress.loaded)} / {humanFileSize(progress.total)}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 font-mono text-[10px] text-red-400 flex items-center gap-1.5">
          <Icon name="x" size={11} /> {error}
        </div>
      )}
    </div>
  );
}

/* ---------- Helpers ---------- */

/** Cleaned-up filename → "Sambo Boy Iskusstvo" from "sambo_boy_iskusstvo.pdf". */
function filenameToTitle(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")        // strip last extension
    .replace(/[_\-.]+/g, " ")       // separators → spaces
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Best-effort PDF title extraction.  Reads the first 64 KB of the file
 * (the catalog + xref + first object stream usually fit), and looks for
 * a `/Title (...)` literal or `/Title <hex...>` form in the metadata
 * dictionary.  Returns undefined on any parse failure — the caller
 * should fall back to the cleaned filename.
 *
 * This is intentionally crude: a real PDF parser (pdfjs-dist) would
 * pull in ~1 MB of JS for one string.  For the long tail of PDFs the
 * /Title is plain ASCII or UTF-16BE prefixed with the BOM, both of
 * which the regex below catches.
 */
async function readPdfTitle(file: File): Promise<string | undefined> {
  if (!file.name.toLowerCase().endsWith(".pdf")) return undefined;
  try {
    const buf = await file.slice(0, 64 * 1024).arrayBuffer();
    const text = new TextDecoder("latin1").decode(buf);
    // Form 1: /Title (literal text). The body matches either a
    // non-special char or a `\X` escape sequence — that way `\(` and
    // `\)` inside the title don't terminate the capture early.
    const lit = text.match(/\/Title\s*\(((?:[^()\\]|\\.){2,300})\)/);
    if (lit) {
      const t = lit[1].trim();
      // PDF literal strings can have escape sequences like \( and \\.
      // Decode the common ones; most titles don't need anything fancy.
      const decoded = t
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .trim();
      if (decoded && decoded.length >= 2) return decoded;
    }
    // Form 2: /Title <FEFF...> — UTF-16BE hex-encoded, BOM-prefixed.
    const hex = text.match(/\/Title\s*<([0-9A-Fa-f]+)>/);
    if (hex) {
      const h = hex[1];
      let result = "";
      if (h.toUpperCase().startsWith("FEFF") && h.length % 4 === 0) {
        for (let i = 4; i < h.length; i += 4) {
          const code = parseInt(h.slice(i, i + 4), 16);
          if (code) result += String.fromCharCode(code);
        }
      } else {
        for (let i = 0; i < h.length; i += 2) {
          const code = parseInt(h.slice(i, i + 2), 16);
          if (code) result += String.fromCharCode(code);
        }
      }
      const trimmed = result.trim();
      if (trimmed.length >= 2) return trimmed;
    }
  } catch {
    /* ignore — caller falls back to filename */
  }
  return undefined;
}

/** Suggest a human-friendly title: PDF metadata first, filename otherwise. */
async function suggestTitle(file: File): Promise<string> {
  const fromPdf = await readPdfTitle(file);
  return fromPdf ?? filenameToTitle(file.name);
}
