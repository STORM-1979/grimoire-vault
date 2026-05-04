"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { humanFileSize, uploadToR2, type UploadKind, type UploadProgress } from "@/lib/upload";

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
  label?: string;
  hint?: string;
}

export function FileUpload({
  kind, accept, maxBytes, value, onChange, label = "Файл", hint,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    if (maxBytes && file.size > maxBytes) {
      setError(`Файл больше ${humanFileSize(maxBytes)}`);
      return;
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

  return (
    <label className="block mb-4">
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
            {busy ? "Загружаю…" : `Перетащи ${fileLabel} или кликни`}
          </div>
          {hint && !busy && (
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
    </label>
  );
}
