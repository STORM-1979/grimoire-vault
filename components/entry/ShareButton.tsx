"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

interface ShareLink {
  id: string;
  entry_id: string;
  expires_at: string | null;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
}

/**
 * Shareable read-only link control on the entry page.  Manages the
 * full lifecycle: list existing links for this entry, create a new
 * one with optional expiry, copy it to the clipboard, revoke any.
 *
 * Lives as a popover anchored to the "Поделиться" button so the
 * page stays uncluttered until the user opens it.
 */
export function ShareButton({ entryId }: { entryId: string }) {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<"never" | "24h" | "7d" | "30d">("never");
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    try {
      const r = await fetch(`/api/share-links?entryId=${entryId}`, {
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { items: ShareLink[] };
      setLinks(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, entryId]);

  const expiresIso = (() => {
    if (expiry === "never") return null;
    const ms = expiry === "24h" ? 24 * 3600e3
             : expiry === "7d"  ? 7 * 24 * 3600e3
             : 30 * 24 * 3600e3;
    return new Date(Date.now() + ms).toISOString();
  })();

  const create = async () => {
    setError(null);
    setBusy(true);
    setJustCreated(null);
    try {
      const r = await fetch("/api/share-links", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, expiresAt: expiresIso }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { token: string };
      const url = `${window.location.origin}/share/${data.token}`;
      setJustCreated(url);
      try { await navigator.clipboard.writeText(url); setCopied(true); }
      catch { /* user copies manually */ }
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Отозвать ссылку? После этого по ней нельзя будет открыть запись.")) return;
    try {
      await fetch(`/api/share-links/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "revoke failed");
    }
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-emerald-300/30 text-emerald-200 hover:border-emerald-300 hover:bg-emerald-300/[0.06] transition flex items-center gap-1.5"
      >
        <Icon name="arrow" size={11} /> Поделиться
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[420px] z-40 rounded-xl border border-gold/40 bg-emerald-deep shadow-2xl p-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-3">
              Public read-only ссылка
            </div>
            <div className="font-mono text-[9px] text-ivory-mute/80 mb-4">
              Любой по ссылке увидит запись без логина.  Можно отозвать в любой момент.
            </div>

            {!justCreated && (
              <div className="space-y-3 mb-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">
                    Срок действия
                  </div>
                  <div className="flex gap-1.5">
                    {(["never", "24h", "7d", "30d"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setExpiry(opt)}
                        className={
                          "font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full transition " +
                          (expiry === opt
                            ? "bg-gold text-emerald-deep"
                            : "border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40")
                        }
                      >
                        {opt === "never" ? "Без срока" : opt}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={create}
                  disabled={busy}
                  className="w-full bg-ivory text-emerald-950 px-4 py-2.5 rounded-full font-mono text-[10px] uppercase tracking-widest hover:bg-emerald-100 disabled:opacity-40 transition flex items-center justify-center gap-2"
                >
                  <Icon name="add" size={11} /> {busy ? "..." : "Создать ссылку"}
                </button>
              </div>
            )}

            {justCreated && (
              <div className="mb-4 p-3 rounded-lg border border-gold/40 bg-gold/[0.05]">
                <div className="font-mono text-[9px] uppercase tracking-widest text-gold mb-1">
                  {copied ? "✓ Скопировано в буфер" : "Создано"}
                </div>
                <div className="font-mono text-[11px] text-ivory break-all leading-snug">
                  {justCreated}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(justCreated); setCopied(true); }
                    catch { /* ignore */ }
                  }}
                  className="mt-2 font-mono text-[9px] uppercase tracking-widest text-ivory-mute hover:text-gold transition"
                >
                  {copied ? "✓ Готово" : "Скопировать снова"}
                </button>
              </div>
            )}

            {links.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">
                  Активные ссылки · {links.length}
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {links.map((l) => {
                    const expired = l.expires_at && new Date(l.expires_at) < new Date();
                    return (
                      <div
                        key={l.id}
                        className="flex items-center justify-between gap-2 p-2 rounded border border-white/10"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[10px] text-ivory truncate">
                            … /share/{l.id.slice(0, 8)}
                          </div>
                          <div className="font-mono text-[9px] text-ivory-mute/70">
                            {expired ? "истекла" : l.expires_at ? `до ${new Date(l.expires_at).toLocaleDateString("ru")}` : "без срока"} · {l.hit_count} переходов
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => revoke(l.id)}
                          className="item-actions-btn danger"
                          title="Отозвать"
                        >
                          <Icon name="x" size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-3 font-mono text-[10px] text-red-400 flex items-center gap-1.5">
                <Icon name="x" size={11} /> {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
