"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

const LS_KEY = "grimoire:portfolio:site-url";

/**
 * Editable "сайт с работами" link shown on the Active Projects
 * category header.  The URL is stored in localStorage — there's no
 * site to point at yet (per user) so a per-device editable field
 * is enough for now; we'll move it to a user_profile column when
 * cross-device sync becomes important.
 *
 * UX:
 *   • Empty   → ghost button "+ Добавить ссылку на сайт".
 *   • Set     → "Открыть сайт →" gold button + small ✏ to edit.
 *   • Edit    → inline input + Сохранить / Отмена.  Empty save
 *               clears the value (back to the empty state).
 */
export function PortfolioSiteLink() {
  const [url, setUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setUrl(window.localStorage.getItem(LS_KEY));
    setHydrated(true);
  }, []);

  const startEdit = () => { setDraft(url ?? ""); setEditing(true); };
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      window.localStorage.setItem(LS_KEY, trimmed);
      setUrl(trimmed);
    } else {
      window.localStorage.removeItem(LS_KEY);
      setUrl(null);
    }
    setEditing(false);
  };
  const cancel = () => { setEditing(false); setDraft(""); };

  // Avoid SSR mismatch — render nothing until localStorage is read.
  if (!hydrated) return null;

  if (editing) {
    return (
      <div className="flex items-center gap-2 mt-4">
        <input
          autoFocus
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") cancel();
          }}
          placeholder="https://my-portfolio.com"
          className="field-input flex-1 max-w-md"
        />
        <button
          type="button"
          onClick={commit}
          className="bg-ivory text-emerald-950 px-4 py-2 rounded-full font-mono text-[10px] uppercase tracking-widest hover:bg-emerald-100 transition flex items-center gap-1.5"
        >
          <Icon name="check" size={11} /> Сохранить
        </button>
        <button
          type="button"
          onClick={cancel}
          className="border border-white/20 text-ivory-dim px-3 py-2 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-white/40 hover:text-ivory transition"
        >
          <Icon name="x" size={11} />
        </button>
      </div>
    );
  }

  if (url) {
    return (
      <div className="flex items-center gap-2 mt-4">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] uppercase tracking-widest px-4 py-2 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
        >
          <Icon name="arrow" size={11} /> Открыть сайт с работами
        </a>
        <button
          type="button"
          onClick={startEdit}
          className="text-ivory-mute hover:text-gold transition p-2"
          title="Изменить ссылку"
        >
          <Icon name="edit" size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className="mt-4 font-mono text-[10px] uppercase tracking-widest px-4 py-2 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
    >
      <Icon name="add" size={11} /> Добавить ссылку на сайт с работами
    </button>
  );
}
