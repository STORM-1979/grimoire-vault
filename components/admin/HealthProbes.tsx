"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";

interface Probe {
  name: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
}
interface HealthResponse {
  ok: boolean;
  checkedAt: string;
  probes: Probe[];
}

const PROBE_LABELS: Record<string, { title: string; help: string }> = {
  "supabase-rest": {
    title: "Supabase REST",
    help: "Service-role HEAD по `categories` — БД доступна + RLS-bypass работает",
  },
  "supabase-pgvector": {
    title: "pgvector RPC",
    help: "Вызов `search_entries_semantic` с нулевым вектором — миграция применена",
  },
  "r2-bucket": {
    title: "Cloudflare R2",
    help: "HEAD bucket — credentials + endpoint валидны",
  },
  "telegram-bot": {
    title: "Telegram-бот",
    help: "Токен валиден — `getMe`",
  },
  "telegram-webhook": {
    title: "Telegram webhook",
    help: "`getWebhookInfo` — покажет `last_error_message`, если доставка зависла",
  },
};

/**
 * Owner-only page client driver: hits /api/admin/health, renders a grid
 * of probes with latency + detail.  Refresh button rebuilds.  No realtime
 * — probes cost real network calls, so they're on-demand.
 */
export function HealthProbes() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/health")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as HealthResponse;
      })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Проверка не удалась"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <section className="max-w-[980px] mx-auto px-10 py-10">
      <div className="flex items-center justify-between mb-5">
        <div className="font-mono text-[11px] uppercase tracking-widest text-gold flex items-center gap-3">
          {data && (
            <span className={`w-2 h-2 rounded-full ${data.ok ? "bg-emerald-400" : "bg-red-400"} ${data.ok ? "animate-pulse" : ""}`} />
          )}
          {loading ? "Проверяю…" : data ? (data.ok ? "Все системы работают" : "Деградация") : "—"}
          {data && <span className="text-ivory-mute">· {new Date(data.checkedAt).toLocaleString("ru-RU")}</span>}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition disabled:opacity-50 flex items-center gap-1.5"
        >
          <Icon name="refresh" size={11} /> {loading ? "…" : "Проверить ещё раз"}
        </button>
      </div>

      {error && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2 mb-4">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.probes.map((p) => {
            const meta = PROBE_LABELS[p.name] ?? { title: p.name, help: "" };
            return (
              <div
                key={p.name}
                className={`keynote rounded-xl p-4 border ${
                  p.ok ? "border-emerald-300/30" : "border-red-400/40 bg-red-400/[0.03]"
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-0.5">
                      {p.name}
                    </div>
                    <h3 className="font-display text-[18px] font-medium leading-tight">
                      {meta.title}
                    </h3>
                  </div>
                  <div className={`flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest flex-shrink-0 ${
                    p.ok ? "text-emerald-200" : "text-red-300"
                  }`}>
                    {p.ok ? <Icon name="check" size={11} /> : <Icon name="x" size={11} />}
                    {p.latencyMs} ms
                  </div>
                </div>
                {p.detail && (
                  <div className="font-mono text-[11px] text-ivory truncate">{p.detail}</div>
                )}
                {p.error && (
                  <div className="font-mono text-[11px] text-red-300 break-words">
                    {p.error}
                  </div>
                )}
                {meta.help && (
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-2 leading-relaxed">
                    {meta.help}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
