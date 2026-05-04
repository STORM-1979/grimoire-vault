"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";

interface SectionSummary { received: number; inserted: number; skipped: number }
interface ImportResult {
  ok: boolean;
  summary: { entries: SectionSummary; kanbanCards: SectionSummary; credentials: SectionSummary };
  errors: string[];
}

/**
 * Counterpart to ExportVault.  Drops a previously-exported (or
 * hand-crafted) JSON file into POST /api/import — handles cross-account
 * migration, restore-after-accident, or merging two vaults.
 *
 * UX choices:
 *   • The file is parsed in the browser before upload so we surface
 *     "version 2" / "this isn't an export file" errors before hitting
 *     the network.
 *   • Duplicate detection is server-side via the unique content_hash
 *     index — the result banner reports `inserted` vs `skipped` per
 *     section so the user understands what actually happened.
 *   • Triggers a `window.location.reload()` on success so any open
 *     supabase realtime subscriptions catch the new rows freshly
 *     instead of partially via socket.
 */
export function ImportVault() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);
    if (file.size > 50 * 1024 * 1024) {
      setError("Файл больше 50 MB — это точно бэкап Grimoire Vault?");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch {
        throw new Error("Файл не валидный JSON");
      }
      if (!parsed || typeof parsed !== "object" || (parsed as { version?: number }).version !== 1) {
        throw new Error("Это не дамп Grimoire Vault v1");
      }
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось импортировать");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="keynote rounded-2xl p-6 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
            Restore · merge · migrate
          </div>
          <h3 className="font-display text-[22px] font-medium leading-tight">
            Import Vault
          </h3>
        </div>
        <Icon name="refresh" size={18} className="text-emerald-200" />
      </div>
      <p className="text-[13.5px] text-ivory-dim leading-snug font-light mb-4">
        Загрузи JSON-файл из <em>Export Vault</em> — все entries, kanban-карточки
        и credentials добавятся в твой текущий vault. Дубли по
        <code className="px-1 mx-1 font-mono text-[12px] bg-white/5 rounded">content_hash</code>
        пропускаются автоматически. Безопасно мерджить дампы из разных
        аккаунтов или восстанавливать после случайного удаления.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="bg-ivory text-emerald-950 px-5 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:bg-emerald-100 disabled:opacity-50 transition inline-flex items-center gap-2"
        >
          <Icon name="add" size={13} /> {busy ? "Импортирую…" : "Выбрать JSON-файл"}
        </button>
        {result && (
          <button
            onClick={() => window.location.reload()}
            className="border border-gold/40 text-gold px-4 py-2 rounded-full font-medium tracking-tight text-[13px] hover:bg-gold hover:text-emerald-deep transition"
          >
            Перезагрузить страницу
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      {result && (
        <div className="mt-4 p-3 rounded-lg border border-emerald-300/30 bg-emerald-200/[0.04]">
          <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-200 mb-2 flex items-center gap-2">
            <Icon name="check" size={11} /> Импорт завершён
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <SummaryCell label="Entries" s={result.summary.entries} />
            <SummaryCell label="Kanban" s={result.summary.kanbanCards} />
            <SummaryCell label="Credentials" s={result.summary.credentials} />
          </div>
          {result.errors.length > 0 && (
            <details className="mt-3">
              <summary className="font-mono text-[10px] uppercase tracking-widest text-red-300 cursor-pointer">
                {result.errors.length} ошиб(к/ок) — раскрыть
              </summary>
              <ul className="text-[11px] text-red-300 font-mono mt-2 space-y-1 list-disc list-inside">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCell({ label, s }: { label: string; s: SectionSummary }) {
  return (
    <div className="text-center">
      <div className="text-ivory-mute uppercase tracking-widest text-[9px] mb-1">{label}</div>
      <div className="text-ivory">
        <span className="text-emerald-200">+{s.inserted}</span>
        <span className="text-ivory-mute mx-1">/</span>
        <span className="text-ivory-mute">{s.received}</span>
      </div>
      {s.skipped > 0 && (
        <div className="text-[9px] uppercase tracking-widest text-ivory-mute mt-0.5">
          {s.skipped} skipped
        </div>
      )}
    </div>
  );
}
