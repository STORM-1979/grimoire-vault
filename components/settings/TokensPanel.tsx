"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

interface PAT {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Personal-access-token management on Settings.  GET lists existing
 * tokens (without ever exposing the raw value); POST creates a new
 * one and the response includes the raw token EXACTLY ONCE for the
 * user to paste into their integration.  DELETE revokes.
 */
export function TokensPanel() {
  const [tokens, setTokens] = useState<PAT[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null);

  const refresh = async () => {
    try {
      const r = await fetch("/api/tokens", { credentials: "same-origin" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { items: PAT[] };
      setTokens(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  };

  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/tokens", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { id: string; token: string };
      setRevealed({ id: data.id, token: data.token });
      setDraft("");
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Отозвать токен? Все интеграции, использующие его, перестанут работать.")) return;
    try {
      await fetch(`/api/tokens/${id}`, { method: "DELETE", credentials: "same-origin" });
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "revoke failed");
    }
  };

  return (
    <section className="rounded-xl border border-white/10 p-6 mb-6">
      <header className="mb-4">
        <h3 className="font-display text-[20px] font-medium leading-none mb-1">
          API-токены
        </h3>
        <p className="text-[13px] text-ivory-dim font-light">
          Личные токены для curl, iOS Shortcuts, Zapier, IFTTT.  Каждый токен
          даёт полный доступ к API от имени твоего аккаунта — храни как пароль.
        </p>
      </header>

      <div className="flex gap-2 mb-5">
        <input
          type="text"
          className="field-input flex-1"
          placeholder="Имя токена (например: iOS Shortcut)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
        />
        <button
          type="button"
          onClick={create}
          disabled={!draft.trim() || busy}
          className="bg-ivory text-emerald-950 px-5 py-2.5 rounded-full font-mono text-[10px] uppercase tracking-widest hover:bg-emerald-100 disabled:opacity-40 transition flex items-center gap-2"
        >
          <Icon name="add" size={11} /> Создать
        </button>
      </div>

      {revealed && (
        <div className="mb-5 p-4 rounded-lg border border-gold/40 bg-gold/[0.05]">
          <div className="font-mono text-[9px] uppercase tracking-widest text-gold mb-2">
            Скопируй сейчас — больше токен показан не будет
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[12px] text-ivory break-all">
              {revealed.token}
            </code>
            <button
              type="button"
              onClick={async () => {
                try { await navigator.clipboard.writeText(revealed.token); }
                catch { /* ignore */ }
              }}
              className="item-actions-btn"
              title="Скопировать"
            >
              <Icon name="copy" size={12} />
            </button>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="item-actions-btn"
              title="Скрыть"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      )}

      {tokens.length === 0 ? (
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute/60 italic">
          — токенов нет —
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-white/10">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[14px] truncate">{t.name}</div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute/70 mt-0.5">
                  создан {new Date(t.created_at).toLocaleDateString("ru")}
                  {t.last_used_at && (
                    <> · последний раз использован {new Date(t.last_used_at).toLocaleDateString("ru")}</>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke(t.id)}
                className="item-actions-btn danger"
                title="Отозвать"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <details className="mt-5">
        <summary className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute cursor-pointer hover:text-gold transition">
          Как использовать →
        </summary>
        <div className="mt-3 p-4 rounded-lg bg-emerald-deep/40 border border-white/10 font-mono text-[11px] text-ivory-dim leading-relaxed">
          <div className="mb-2 text-gold">curl — создать запись:</div>
          <pre className="whitespace-pre-wrap mb-4 text-[10px]">{`curl -X POST https://grimoire-vault.vercel.app/api/v1/entries \\
  -H "Authorization: Bearer gv_pat_..." \\
  -H "Content-Type: application/json" \\
  -d '{"categoryId":"ideas","title":"Hello"}'`}</pre>
          <div className="mb-2 text-gold">iOS Shortcuts:</div>
          <div className="text-[11px]">
            Add Action → Get Contents of URL.  Method: POST.  URL:
            https://grimoire-vault.vercel.app/api/v1/entries.  Headers:
            Authorization = Bearer gv_pat_…, Content-Type = application/json.
            Request body: JSON c полями `categoryId`, `title`.
          </div>
        </div>
      </details>

      {error && (
        <div className="mt-3 font-mono text-[10px] text-red-400 flex items-center gap-1.5">
          <Icon name="x" size={11} /> {error}
        </div>
      )}
    </section>
  );
}
