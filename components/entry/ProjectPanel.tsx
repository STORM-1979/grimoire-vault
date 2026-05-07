"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { entriesApi } from "@/lib/api-client";
import type { Entry } from "@/lib/types";

interface ProjectLink { label: string; url: string }
interface ProjectCred { label: string; value: string }

/**
 * Workspace panel for portfolio (active-project) entries.
 *
 *   1. Quick links — read-only chips for Vercel / GitHub / DB pulled
 *      from the values entered in AddItemModal.
 *   2. ТЗ — long-form spec text persisted in entry.body. Autosaves
 *      on blur after a debounce so the user doesn't have to click
 *      Save constantly.
 *   3. Custom links — array of {label, url} living in metadata.
 *   4. Credentials — array of {label, value} with a hide-by-default
 *      input (toggleable eye).  Stored in plaintext metadata, NOT
 *      encrypted; the panel notes this so the user can move sensitive
 *      stuff to the dedicated Credentials category if needed.
 *
 * All writes go through PATCH /api/entries/[id]. The panel keeps a
 * local mirror of the metadata object so adds / removes feel
 * instant; the PATCH replaces the relevant slice on success.
 */
export function ProjectPanel({ entry }: { entry: Entry }) {
  // Local mirrors hydrated from the entry passed in by the server.
  const [spec, setSpec] = useState(entry.body ?? "");
  const [links, setLinks] = useState<ProjectLink[]>(
    Array.isArray(entry.metadata?.extraLinks)
      ? (entry.metadata.extraLinks as ProjectLink[])
      : [],
  );
  const [creds, setCreds] = useState<ProjectCred[]>(
    Array.isArray(entry.metadata?.creds)
      ? (entry.metadata.creds as ProjectCred[])
      : [],
  );
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [savingSpec, setSavingSpec] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vercelUrl = (entry.metadata?.vercelUrl as string | undefined) ?? "";
  const gitUrl    = (entry.metadata?.gitUrl    as string | undefined) ?? "";
  const dbUrl     = (entry.metadata?.dbUrl     as string | undefined) ?? "";
  const hasQuickLinks = !!(vercelUrl || gitUrl || dbUrl);

  // Debounced autosave for the ТЗ textarea.  Triggers 800 ms after
  // the last keystroke or immediately on blur, whichever comes first.
  const specTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSpec = async (next: string) => {
    setError(null);
    setSavingSpec(true);
    try {
      await entriesApi.update(entry.id, { body: next || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить ТЗ");
    } finally {
      setSavingSpec(false);
    }
  };
  useEffect(() => {
    return () => { if (specTimer.current) clearTimeout(specTimer.current); };
  }, []);
  const onSpecChange = (next: string) => {
    setSpec(next);
    if (specTimer.current) clearTimeout(specTimer.current);
    specTimer.current = setTimeout(() => { saveSpec(next); }, 800);
  };
  const onSpecBlur = () => {
    if (specTimer.current) clearTimeout(specTimer.current);
    if ((spec ?? "") !== (entry.body ?? "")) saveSpec(spec);
  };

  // Helper: persist `metadata` patch with the latest links/creds.
  // Always sends a complete object so cleared keys actually clear
  // server-side instead of being silently dropped.
  const persistMeta = async (next: { links?: ProjectLink[]; creds?: ProjectCred[] }) => {
    setError(null);
    try {
      await entriesApi.update(entry.id, {
        metadata: {
          ...entry.metadata,
          extraLinks: next.links ?? links,
          creds: next.creds ?? creds,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const addLink = () => {
    const next = [...links, { label: "", url: "" }];
    setLinks(next);
  };
  const updateLink = (i: number, patch: Partial<ProjectLink>) => {
    const next = links.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    setLinks(next);
  };
  const commitLink = (i: number) => {
    // Drop blank rows on commit (both label and url empty), no-op
    // otherwise.  Persistence then sends the cleaned array.
    const cleaned = links.filter((l) => l.label.trim() || l.url.trim());
    if (cleaned.length !== links.length) setLinks(cleaned);
    void i;
    persistMeta({ links: cleaned });
  };
  const removeLink = (i: number) => {
    const next = links.filter((_, idx) => idx !== i);
    setLinks(next);
    persistMeta({ links: next });
  };

  const addCred = () => setCreds([...creds, { label: "", value: "" }]);
  const updateCred = (i: number, patch: Partial<ProjectCred>) => {
    setCreds(creds.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const commitCred = () => {
    const cleaned = creds.filter((c) => c.label.trim() || c.value.trim());
    if (cleaned.length !== creds.length) setCreds(cleaned);
    persistMeta({ creds: cleaned });
  };
  const removeCred = (i: number) => {
    const next = creds.filter((_, idx) => idx !== i);
    setCreds(next);
    setRevealed((prev) => {
      const out = new Set<number>();
      // Re-index remaining reveals — index i is gone, anything after
      // it shifts down by one.
      for (const r of prev) {
        if (r === i) continue;
        out.add(r > i ? r - 1 : r);
      }
      return out;
    });
    persistMeta({ creds: next });
  };
  const toggleReveal = (i: number) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <section className="max-w-[1080px] mx-auto px-10 py-10 space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
            Проект · рабочая панель
          </div>
          <h2 className="font-display text-[28px] font-medium leading-none">Детали проекта</h2>
        </div>
        {savingSpec && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-200">
            сохраняю…
          </div>
        )}
      </header>

      {error && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {/* 1. Quick links (read-only — change via Edit modal) */}
      {hasQuickLinks && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-3">
            Быстрые ссылки
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {vercelUrl && <QuickLink label="Vercel" url={vercelUrl} />}
            {gitUrl    && <QuickLink label="GitHub" url={gitUrl} />}
            {dbUrl     && <QuickLink label="БД"     url={dbUrl} />}
          </div>
        </div>
      )}

      {/* 2. ТЗ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
            Техническое задание
          </div>
          <span className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute/70">
            автосохранение
          </span>
        </div>
        <textarea
          className="field-textarea min-h-[220px] font-mono text-[12.5px] leading-relaxed"
          value={spec}
          onChange={(e) => onSpecChange(e.target.value)}
          onBlur={onSpecBlur}
          placeholder="Опиши задачу, требования, бизнес-цели, ограничения…"
        />
      </div>

      {/* 3. Custom links */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
            Дополнительные ссылки
          </div>
          <button
            type="button"
            onClick={addLink}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
          >
            <Icon name="add" size={11} /> Ссылка
          </button>
        </div>
        {links.length === 0 ? (
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute/60 italic">
            — пусто —
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((l, i) => (
              <div key={i} className="grid grid-cols-[200px_1fr_auto] gap-2 items-center">
                <input
                  type="text"
                  className="field-input"
                  placeholder="Название (Figma, Stage, Doc…)"
                  value={l.label}
                  onChange={(e) => updateLink(i, { label: e.target.value })}
                  onBlur={() => commitLink(i)}
                />
                <input
                  type="text"
                  className="field-input"
                  placeholder="https://…"
                  value={l.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  onBlur={() => commitLink(i)}
                />
                <div className="flex items-center gap-1">
                  {l.url && (
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="item-actions-btn"
                      title="Открыть"
                    >
                      <Icon name="arrow" size={12} />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => removeLink(i)}
                    className="item-actions-btn danger"
                    title="Удалить"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Credentials */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
              Доступы и пароли
            </div>
            <div className="font-mono text-[9px] text-ivory-mute/70 mt-1">
              хранятся как обычный текст — для секретов используй категорию «Credentials»
            </div>
          </div>
          <button
            type="button"
            onClick={addCred}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
          >
            <Icon name="add" size={11} /> Запись
          </button>
        </div>
        {creds.length === 0 ? (
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute/60 italic">
            — пусто —
          </div>
        ) : (
          <div className="space-y-2">
            {creds.map((c, i) => {
              const isRevealed = revealed.has(i);
              return (
                <div key={i} className="grid grid-cols-[200px_1fr_auto] gap-2 items-center">
                  <input
                    type="text"
                    className="field-input"
                    placeholder="Название (DB pass, API key…)"
                    value={c.label}
                    onChange={(e) => updateCred(i, { label: e.target.value })}
                    onBlur={commitCred}
                  />
                  <input
                    type={isRevealed ? "text" : "password"}
                    className="field-input font-mono"
                    placeholder="значение"
                    value={c.value}
                    onChange={(e) => updateCred(i, { value: e.target.value })}
                    onBlur={commitCred}
                    autoComplete="off"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleReveal(i)}
                      className="item-actions-btn"
                      title={isRevealed ? "Скрыть" : "Показать"}
                    >
                      <Icon name={isRevealed ? "eyeOff" : "eye"} size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (c.value) navigator.clipboard.writeText(c.value).catch(() => {});
                      }}
                      className="item-actions-btn"
                      title="Скопировать значение"
                      disabled={!c.value}
                    >
                      <Icon name="copy" size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCred(i)}
                      className="item-actions-btn danger"
                      title="Удалить"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function QuickLink({ label, url }: { label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
    >
      <Icon name="arrow" size={11} /> {label}
    </a>
  );
}
