"use client";

import { Icon } from "@/components/icons/Icon";

/**
 * Inline preview of the entry's primary file or URL (`entry.url`).
 *
 * Sits between the hero section and the EntryBoard on /entry/[id].
 * Without this, users see the toolbar ("Картинка / Видео / Файл / …")
 * and assume those buttons preview the existing attachment — but the
 * toolbar adds NEW blocks to the board.  This component shows what's
 * already attached so the workflow is unambiguous.
 *
 * The render is type-aware — we sniff the URL/extension to pick the
 * right element:
 *   • YouTube / Vimeo  → embedded iframe player
 *   • image            → <img>
 *   • PDF              → <iframe> (browser PDF viewer)
 *   • video file       → <video controls>
 *   • audio file       → <audio controls>
 *   • everything else  → big "Скачать / открыть" card (DjVu, FB2,
 *                        EPUB, DOCX — formats no browser can render
 *                        natively land here)
 */
export function EntryPrimaryView({
  url, title, sizeLabel, duration,
}: {
  url: string;
  title: string;
  sizeLabel?: string | null;
  duration?: string | null;
}) {
  // Defence in depth — only render http(s) and our own /api/r2/* paths.
  // Anything else (data:, javascript:, file:) is a no-op.
  if (!/^(https?:|\/api\/r2\/)/.test(url)) return null;

  const ext = getExt(url);

  const yt = ytId(url);
  if (yt) {
    return (
      <Container label={`YouTube${duration ? ` · ${duration}` : ""} · ${title}`}>
        <iframe
          src={`https://www.youtube.com/embed/${yt}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="w-full aspect-video rounded-xl border border-white/10 bg-black"
        />
      </Container>
    );
  }

  const vm = vimeoId(url);
  if (vm) {
    return (
      <Container label={`Vimeo${duration ? ` · ${duration}` : ""} · ${title}`}>
        <iframe
          src={`https://player.vimeo.com/video/${vm}`}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="w-full aspect-video rounded-xl border border-white/10 bg-black"
        />
      </Container>
    );
  }

  if (IMAGE_EXTS.includes(ext)) {
    return (
      <Container label={`Изображение · ${ext.toUpperCase()}${sizeLabel ? ` · ${sizeLabel}` : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={title}
          className="max-w-full max-h-[80vh] mx-auto rounded-xl border border-white/10 block"
        />
      </Container>
    );
  }

  if (ext === "pdf") {
    return (
      <Container label={`PDF${sizeLabel ? ` · ${sizeLabel}` : ""}`}>
        <iframe
          src={url}
          title={title}
          className="w-full h-[85vh] rounded-xl border border-white/10 bg-ivory"
        />
        <div className="mt-3 flex justify-end">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
          >
            <Icon name="arrow" size={11} /> Открыть в новой вкладке
          </a>
        </div>
      </Container>
    );
  }

  if (VIDEO_EXTS.includes(ext)) {
    return (
      <Container label={`Видео · ${ext.toUpperCase()}${duration ? ` · ${duration}` : ""}${sizeLabel ? ` · ${sizeLabel}` : ""}`}>
        <video
          src={url}
          controls
          preload="metadata"
          className="w-full max-h-[80vh] rounded-xl border border-white/10 bg-black"
        />
      </Container>
    );
  }

  if (AUDIO_EXTS.includes(ext)) {
    return (
      <Container label={`Аудио · ${ext.toUpperCase()}${duration ? ` · ${duration}` : ""}${sizeLabel ? ` · ${sizeLabel}` : ""}`}>
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full"
        />
      </Container>
    );
  }

  // Fallback: download / open card.  Used for DjVu, EPUB, MOBI, FB2,
  // DOCX, ZIP, plus any extension we didn't recognise.  Browser doesn't
  // know how to render these inline, so we make the action obvious
  // instead of pretending we can preview them.
  return (
    <Container label={`Файл${ext ? ` · ${ext.toUpperCase()}` : ""}${sizeLabel ? ` · ${sizeLabel}` : ""}`}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block p-10 rounded-xl border border-gold/40 bg-emerald-900/30 hover:bg-emerald-800/40 hover:border-gold/70 transition text-center group"
      >
        <Icon name="documents" size={56} className="mx-auto text-gold mb-4 transition-transform group-hover:scale-105" />
        <div className="font-display text-[22px] font-medium mb-2">Скачать или открыть</div>
        <div className="font-mono text-[11px] uppercase tracking-widest text-ivory-mute">
          {ext ? `${ext.toUpperCase()} · ` : ""}{sizeLabel ?? ""}
          {ext && !["pdf", ...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS].includes(ext) && (
            <span className="block mt-2 normal-case tracking-normal text-[10px] opacity-75">
              Браузер не отображает этот формат — откроется во внешнем приложении
            </span>
          )}
        </div>
      </a>
    </Container>
  );
}

/* -------------------- helpers -------------------- */

function Container({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="max-w-[1080px] mx-auto px-10 pt-8 pb-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-3">{label}</div>
      {children}
    </section>
  );
}

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp", "tiff", "tif", "heic", "heif"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "avi", "wmv", "m4v", "3gp"];
const AUDIO_EXTS = ["mp3", "wav", "m4a", "ogg", "flac", "aac"];

function getExt(url: string): string {
  // Strip query + hash, then read the last `.ext`.  R2 keys are
  // `users/<uid>/originals/<rand>-<slug>.<ext>` so this works for both
  // R2-served URLs and direct external links.
  const path = url.split(/[?#]/)[0];
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function ytId(url: string): string | null {
  try {
    const u = new URL(url, "http://x.invalid");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const h = u.hostname.replace(/^www\./, "");
    if (h === "youtube.com" || h === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
      if (m) return m[1];
    }
    if (h === "youtu.be") {
      const m = u.pathname.match(/^\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch { /* noop */ }
  return null;
}

function vimeoId(url: string): string | null {
  try {
    const u = new URL(url, "http://x.invalid");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.hostname.includes("vimeo.com")) {
      const m = u.pathname.match(/^\/(\d+)/);
      if (m) return m[1];
    }
  } catch { /* noop */ }
  return null;
}
