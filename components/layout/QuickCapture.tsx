"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { entriesApi, ApiError } from "@/lib/api-client";
import type { CategoryId } from "@/lib/types";

/**
 * Floating "what's on your mind" capture overlay.  Bound to the
 * global Cmd/Ctrl+Shift+N hotkey so a thought never has to wait for
 * a category page to open.
 *
 * Auto-detects category by content shape:
 *   • starts with http(s) + youtube.com/youtu.be → youtube
 *   • starts with http(s) + github.com/figma.com/dribbble.com → designs/web
 *   • starts with http(s) generic → web
 *   • plain text → ideas
 *
 * Enter saves; Esc closes; Tab cycles category override; Shift+Enter
 * inserts a newline so multi-line ideas are still ergonomic.
 */
export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [categoryOverride, setCategoryOverride] = useState<CategoryId | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Global hotkey + Esc-to-close.  Keydown is captured at the
  // document level so it works no matter what's focused.
  //
  // Combo: Cmd/Ctrl+Shift+; (semicolon).  Earlier draft used
  // Cmd+Shift+N but Chrome eats that at the OS level — it opens an
  // Incognito window and our keydown listener never fires.
  // Semicolon is free in every major browser; a bit awkward to
  // type two-handed but it's reliable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCapture =
        (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === ";";
      if (isCapture) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (open && e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Autofocus textarea on open + reset transient state.
  useEffect(() => {
    if (open) {
      setText("");
      setCategoryOverride(null);
      setError(null);
      // Wait for paint so the textarea exists before we focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Auto-dismiss toast after 2 s.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const detected = detectCategory(text);
  const effective = categoryOverride ?? detected;

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setError(null);
    setBusy(true);
    try {
      // For URL-bearing entries we save the URL, the app's existing
      // extraction will fill og:meta on next view.  For plain text
      // we use the first line as the title and put the rest in
      // description so a multi-paragraph idea isn't truncated to 200
      // chars on save.
      const url = extractUrl(value);
      let title: string;
      let description: string | null;
      if (url) {
        title = url;
        description = value.replace(url, "").trim() || null;
      } else {
        const lines = value.split("\n");
        title = lines[0].slice(0, 200);
        const rest = lines.slice(1).join("\n").trim();
        description = rest || (lines[0].length > 200 ? lines[0].slice(200, 4000) : null);
      }
      await entriesApi.create({
        categoryId: effective,
        title,
        description,
        url: url ?? undefined,
        tags: [],
        pinned: false,
        metadata: { capturedVia: "quick" },
        importedVia: "web",
      });
      setToast(`✓ В ${prettyName(effective)}`);
      setOpen(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center pt-32"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-emerald-deep/60 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-[520px] max-w-[92vw] rounded-2xl border border-gold/40 bg-emerald-deep shadow-2xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-gold">
                Быстрая запись
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="item-actions-btn"
                title="Закрыть (Esc)"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            <textarea
              ref={inputRef}
              className="field-textarea min-h-[100px] mb-3"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  setCategoryOverride(cycleCategory(effective));
                }
              }}
              placeholder="Что записать? Enter — сохранить · Shift+Enter — новая строка · Tab — сменить категорию"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute">
                  →
                </span>
                <button
                  type="button"
                  onClick={() => setCategoryOverride(cycleCategory(effective))}
                  className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
                  title="Сменить категорию (Tab)"
                >
                  {prettyName(effective)}
                </button>
                {!categoryOverride && text.trim() && (
                  <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute/70">
                    auto-detect
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!text.trim() || busy}
                className="bg-ivory text-emerald-950 px-5 py-2 rounded-full font-mono text-[10px] uppercase tracking-widest hover:bg-emerald-100 disabled:opacity-40 transition flex items-center gap-2"
              >
                <Icon name="check" size={11} /> {busy ? "..." : "Сохранить"}
              </button>
            </div>
            {error && (
              <div className="mt-3 font-mono text-[10px] text-red-400 flex items-center gap-1.5">
                <Icon name="x" size={11} /> {error}
              </div>
            )}
            <div className="mt-3 font-mono text-[9px] text-ivory-mute/60">
              ⌘⇧; / Ctrl+Shift+; открывает это окно откуда угодно
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] bg-gold text-emerald-deep px-4 py-2.5 rounded-full font-mono text-[11px] uppercase tracking-widest shadow-2xl animate-fade-in">
          {toast}
        </div>
      )}
    </>
  );
}

/* ---------- helpers ---------- */

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)>"'`]+/);
  return m ? m[0] : null;
}

function detectCategory(text: string): CategoryId {
  const url = extractUrl(text);
  if (!url) return "ideas";
  if (/(?:youtube\.com|youtu\.be)/.test(url)) return "youtube";
  if (/(?:behance\.net|dribbble\.com|figma\.com)/.test(url)) return "designs";
  if (/(?:github\.com\/.*\/.*)/.test(url) && /skill|tool|cli/i.test(text)) return "skills";
  return "web";
}

function prettyName(id: CategoryId): string {
  const map: Partial<Record<CategoryId, string>> = {
    documents: "Documents",
    web: "Web",
    youtube: "YouTube",
    local: "Local",
    designs: "Designs",
    images: "Images",
    skills: "Skills",
    prompts: "Prompts",
    kanban: "Kanban",
    ideas: "Ideas",
    portfolio: "Active Projects",
    misc: "Misc",
    credentials: "Credentials",
  };
  return map[id] ?? id;
}

const CYCLE: CategoryId[] = ["ideas", "web", "youtube", "designs", "skills", "prompts", "misc"];
function cycleCategory(current: CategoryId): CategoryId {
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length];
}
