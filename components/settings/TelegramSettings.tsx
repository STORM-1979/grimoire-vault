"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { CopyButton } from "@/components/credentials/CopyButton";

interface SessionInfo {
  linked: boolean;
  pendingCode?: string | null;
  linkCodeExpires?: string | null;
  chatId?: number | null;
}

export function TelegramSettings() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ value: string; expiresAt: string } | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/telegram/link-code", { credentials: "same-origin" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInfo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить");
    }
  };

  useEffect(() => { refresh(); }, []);

  const issue = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/telegram/link-code", { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setCode({ value: data.code, expiresAt: data.expiresAt });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать код");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!confirm("Отвязать Telegram-чат?")) return;
    setBusy(true);
    try {
      await fetch("/api/telegram/link-code", { method: "DELETE", credentials: "same-origin" });
      setCode(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!info) {
    return (
      <div className="keynote rounded-2xl p-7">
        <h3 className="font-display text-[28px] font-medium leading-none">Telegram</h3>
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">Загружаю…</div>
      </div>
    );
  }

  return (
    <div className="keynote rounded-2xl p-7">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="font-display text-[28px] font-medium leading-none">Telegram</h3>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">
            Bot: <a href="https://t.me/TheBaseofKnowladge_bot" target="_blank" rel="noopener" className="text-gold hover:underline">@TheBaseofKnowladge_bot</a>
          </div>
        </div>
        {info.linked ? (
          <span className="tag-emerald inline-flex items-center gap-1.5">
            <Icon name="check" size={11} /> Linked
          </span>
        ) : (
          <span className="tag inline-flex items-center gap-1.5">
            <Icon name="x" size={11} /> Not linked
          </span>
        )}
      </div>

      {info.linked && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-[14px]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">Chat ID</div>
              <div className="font-mono text-[14px] text-ivory">{info.chatId}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">Status</div>
              <div className="flex items-center gap-2 text-[14px] text-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online · webhook active
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-white/10 flex justify-end">
            <button
              onClick={unlink}
              disabled={busy}
              className="border border-white/20 text-ivory-dim px-4 py-2 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-red-400 hover:text-red-400 transition disabled:opacity-50"
            >
              Unlink chat
            </button>
          </div>
        </div>
      )}

      {!info.linked && (
        <div className="space-y-4">
          <p className="text-[14px] text-ivory-dim leading-snug">
            Чтобы привязать Telegram — сгенерируй короткий код и отправь его боту командой{" "}
            <code className="font-mono text-gold bg-emerald-deep/40 px-1.5 py-0.5 rounded">/link &lt;код&gt;</code>.
          </p>

          {!code && info.pendingCode && info.linkCodeExpires && new Date(info.linkCodeExpires) > new Date() && (
            <div className="bg-emerald-glass border border-gold/30 rounded-lg p-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">Активный код</div>
              <div className="flex items-center gap-3">
                <code className="font-mono text-[24px] text-ivory font-bold flex-1">{info.pendingCode}</code>
                <CopyButton value={info.pendingCode} label="link code" clearAfterMs={0} />
              </div>
              <div className="font-mono text-[9px] text-ivory-mute mt-2">
                Истекает {new Date(info.linkCodeExpires).toLocaleString("ru-RU")}
              </div>
            </div>
          )}

          {code && (
            <div className="bg-emerald-glass border border-gold/40 rounded-lg p-4 animate-pulse-once">
              <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2 flex items-center gap-1.5">
                <Icon name="check" size={11} /> Новый код (10 минут)
              </div>
              <div className="flex items-center gap-3">
                <code className="font-mono text-[26px] text-ivory font-bold flex-1">/link {code.value}</code>
                <CopyButton value={`/link ${code.value}`} label="команду" clearAfterMs={0} />
              </div>
              <div className="font-mono text-[9px] text-ivory-mute mt-2">
                Перешли эту команду боту в Telegram → ваш чат привяжется.
              </div>
            </div>
          )}

          <button
            onClick={issue}
            disabled={busy}
            className="bg-ivory text-emerald-950 px-5 py-2.5 rounded-full font-medium tracking-tight hover:bg-emerald-100 disabled:opacity-50 transition flex items-center gap-2"
          >
            <Icon name="refresh" size={14} /> {busy ? "..." : "Issue link code"}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}
    </div>
  );
}
