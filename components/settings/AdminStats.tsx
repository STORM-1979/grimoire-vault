"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { CATEGORIES } from "@/lib/categories";

interface WipeResult {
  ok: boolean;
  deleted: { entries: number; kanbanCards: number; credentials: number; r2Objects: number };
  errors: string[];
}

interface Stats {
  generatedAt: string;
  runtime?: { version: string; commit: string | null; env: string; nodeVersion: string };
  migrations?: { applied: number; latest: string | null; latestAt: string | null };
  totals: { entries: number; kanbanCards: number; credentials: number };
  triage: { botImported: number; untriaged: number; embedded: number; embeddingCoverage: number };
  timestamps: { lastEntryAt: string | null; lastBotImportAt: string | null };
  categories: Record<string, number>;
  r2: {
    count: number;
    bytes: number;
    byKind: Record<string, { count: number; bytes: number }>;
  };
}

/**
 * Owner-only ops dashboard, mounted from Settings.
 *
 * The parent server component already verified `isOwnerEmail(user.email)`
 * before rendering this — the route handler enforces it again on its
 * end.  If anyone non-owner ever lands on this component (e.g. bug),
 * the fetch returns 403 and we show a graceful "you don't have access"
 * message instead of leaking shape.
 */
export function AdminStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/stats")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Stats;
      })
      .then(setStats)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Не удалось загрузить"))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  return (
    <div className="keynote rounded-2xl p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
            Только для владельца · операционная
          </div>
          <h3 className="font-display text-[22px] font-medium leading-tight">
            Статистика vault&apos;а
          </h3>
          {stats && (
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-1 flex items-center gap-2 flex-wrap">
              <span>v{stats.runtime?.version ?? "?"}</span>
              {stats.runtime?.commit && <span className="text-gold">· {stats.runtime.commit}</span>}
              {stats.migrations && <span>· {stats.migrations.applied} migrations</span>}
              <span>· {new Date(stats.generatedAt).toLocaleString("ru-RU")}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/health"
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition flex items-center gap-1.5"
          >
            <Icon name="shield" size={11} /> Health
          </Link>
          <button
            onClick={refresh}
            disabled={loading}
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/15 text-ivory-mute hover:border-gold hover:text-gold transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <Icon name="refresh" size={11} /> {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Tile label="Записи" value={stats.totals.entries} />
            <Tile label="Канбан" value={stats.totals.kanbanCards} />
            <Tile label="Credentials" value={stats.totals.credentials} />
          </div>

          <div className="grid grid-cols-4 gap-3 mb-5">
            <Tile small label="От бота" value={stats.triage.botImported} />
            <Tile small label="Не разобрано" value={stats.triage.untriaged} accent={stats.triage.untriaged > 0 ? "gold" : undefined} />
            <Tile small label="Embedded" value={stats.triage.embedded} />
            <Tile small label="Coverage" value={`${stats.triage.embeddingCoverage}%`} />
          </div>

          {/* Per-category */}
          <div className="mb-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">
              По категориям
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {CATEGORIES.map((c) => (
                <div key={c.id} className="px-3 py-2 rounded-lg bg-white/[0.03] flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute truncate">
                    {c.no} · {c.en}
                  </span>
                  <span className="font-display text-[16px] text-ivory">
                    {stats.categories[c.id] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* R2 */}
          <div className="mb-5">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">
              R2 storage
            </div>
            <div className="grid grid-cols-4 gap-3">
              <Tile small label="Всего" value={`${stats.r2.count} · ${humanBytes(stats.r2.bytes)}`} />
              <Tile small label="Originals" value={`${stats.r2.byKind.originals?.count ?? 0} · ${humanBytes(stats.r2.byKind.originals?.bytes ?? 0)}`} />
              <Tile small label="Covers" value={`${stats.r2.byKind.covers?.count ?? 0} · ${humanBytes(stats.r2.byKind.covers?.bytes ?? 0)}`} />
              <Tile small label="Thumbs" value={`${stats.r2.byKind.thumbs?.count ?? 0} · ${humanBytes(stats.r2.byKind.thumbs?.bytes ?? 0)}`} />
            </div>
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Tile small label="Последняя запись" value={fmtTs(stats.timestamps.lastEntryAt)} />
            <Tile small label="Последний импорт от бота" value={fmtTs(stats.timestamps.lastBotImportAt)} />
          </div>

          <DangerZone onWiped={refresh} />
        </>
      )}
    </div>
  );
}

/**
 * Two-stage destructive action.
 *
 *   1. Owner expands the block (one click to acknowledge it exists).
 *   2. Owner types the literal word "WIPE" — confirm button enables.
 *   3. Owner clicks confirm; we still ask once via `window.confirm()`
 *      to defend against muscle-memory misfires after typing the word.
 *   4. POST /api/admin/wipe with `{confirm: "WIPE"}` — server requires
 *      the same magic word, so a successful curl can't fire it without
 *      both pieces.
 *
 * On success the result banner stays put with deletion counts; calling
 * `onWiped` refreshes the stats above so the user sees zeroes.
 */
function DangerZone({ onWiped }: { onWiped: () => void }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WipeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const armed = phrase === "WIPE";

  const onWipe = async () => {
    if (!armed || busy) return;
    if (!confirm("Это удалит ВСЕ твои entries, kanban-карточки, credentials и R2-файлы. Продолжить?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "WIPE" }),
      });
      const body = (await r.json()) as WipeResult & { error?: string };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setResult(body);
      setPhrase("");
      onWiped();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wipe failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full mt-2 px-4 py-3 rounded-lg border border-red-400/30 text-red-300 font-mono text-[10px] uppercase tracking-widest hover:border-red-400/60 hover:bg-red-400/[0.05] transition flex items-center gap-2 justify-center"
      >
        <Icon name="x" size={11} /> Danger zone — раскрыть
      </button>
    );
  }

  return (
    <div className="mt-2 p-4 rounded-lg border border-red-400/40 bg-red-400/[0.04]">
      <div className="flex items-center justify-between mb-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-red-300 flex items-center gap-2">
          <Icon name="x" size={11} /> Danger zone
        </div>
        <button
          onClick={() => { setOpen(false); setPhrase(""); setResult(null); setError(null); }}
          className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute hover:text-ivory transition"
        >
          Свернуть
        </button>
      </div>
      <p className="text-[13px] text-ivory-dim leading-snug font-light mb-3">
        Удалит все entries, kanban-карточки, credentials и R2-файлы (covers, thumbs, originals)
        текущего владельца.
        Аккаунт и Telegram-привязка остаются. Полезно для чистого рестарта после миграции или тестов.
        Действие <strong>необратимо</strong> — сделай <em>Full export</em> заранее.
      </p>
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder='Введи "WIPE" чтобы разблокировать'
          className="field-input flex-1 font-mono text-[13px]"
        />
        <button
          onClick={onWipe}
          disabled={!armed || busy}
          className="font-mono text-[10px] uppercase tracking-widest px-4 py-2 rounded-full border border-red-400/40 text-red-300 hover:bg-red-400 hover:text-emerald-deep transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          <Icon name="x" size={11} /> {busy ? "Удаляю…" : "Wipe vault"}
        </button>
      </div>

      {error && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {result && (
        <div className="mt-2 p-3 rounded-lg border border-emerald-300/30 bg-emerald-200/[0.04]">
          <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-200 mb-2 flex items-center gap-2">
            <Icon name="check" size={11} /> Vault очищен
          </div>
          <div className="font-mono text-[11px] grid grid-cols-2 gap-1 text-ivory-dim">
            <span>Записи: {result.deleted.entries}</span>
            <span>Канбан: {result.deleted.kanbanCards}</span>
            <span>Credentials: {result.deleted.credentials}</span>
            <span>R2-файлов: {result.deleted.r2Objects}</span>
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="font-mono text-[10px] uppercase tracking-widest text-red-300 cursor-pointer">
                {result.errors.length} ошиб(к/ок)
              </summary>
              <ul className="text-[11px] text-red-300 font-mono mt-1 space-y-0.5 list-disc list-inside">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, small, accent }: {
  label: string; value: number | string; small?: boolean; accent?: "gold";
}) {
  return (
    <div className={`keynote rounded-lg p-3 text-center ${accent === "gold" ? "border-gold/40" : ""}`}>
      <div className={`font-display ${small ? "text-[20px]" : "text-[28px]"} font-light leading-none ${accent === "gold" ? "text-gold" : "text-ivory"}`}>
        {value}
      </div>
      <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">
        {label}
      </div>
    </div>
  );
}

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
