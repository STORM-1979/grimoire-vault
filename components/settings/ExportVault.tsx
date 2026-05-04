"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { createClient } from "@/lib/supabase/client";

/**
 * "Export Vault" panel — single button that downloads a full backup of
 * the calling user's data as a JSON file.  No client-side ZIP, no
 * streaming UI; the route handler returns the file with
 * `Content-Disposition: attachment` and the browser handles the rest.
 *
 * This component just teases what's about to be downloaded so the user
 * isn't surprised by the file: live counts of entries / kanban cards /
 * credentials, fetched via supabase-js (RLS-scoped) on mount.
 */
export function ExportVault() {
  const [counts, setCounts] = useState<{ entries: number; kanban: number; creds: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [{ count: e }, { count: k }, { count: c }] = await Promise.all([
        supabase.from("entries").select("id", { count: "exact", head: true }),
        supabase.from("kanban_cards").select("id", { count: "exact", head: true }),
        supabase.from("credentials").select("id", { count: "exact", head: true }),
      ]);
      if (!cancelled) setCounts({ entries: e ?? 0, kanban: k ?? 0, creds: c ?? 0 });
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="keynote rounded-2xl p-6 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">
            Backup · own your data
          </div>
          <h3 className="font-display text-[22px] font-medium leading-tight">
            Export Vault
          </h3>
        </div>
        <Icon name="shield" size={18} className="text-emerald-200" />
      </div>
      <p className="text-[13.5px] text-ivory-dim leading-snug font-light mb-4">
        Один клик — и ты получаешь весь свой вольт в виде JSON-файла:
        записи во всех 13 категориях, доска kanban, зашифрованные
        credentials. Embeddings не включаются (восстанавливаются
        локально через Reindex), R2-файлы — по URL в JSON. Master-пароль
        от vault never leaves твой браузер: credentials в экспорте —
        только AES-GCM-шифротексты.
      </p>

      {counts && (
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-4 flex items-center gap-3">
          <span>{counts.entries} entries</span>
          <span>·</span>
          <span>{counts.kanban} kanban cards</span>
          <span>·</span>
          <span>{counts.creds} credentials</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <a
          href="/api/export"
          download
          className="bg-ivory text-emerald-950 px-5 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:bg-emerald-100 transition inline-flex items-center gap-2"
        >
          <Icon name="arrow" size={13} /> JSON-бэкап
        </a>
        <a
          href="/api/export/full"
          download
          title="JSON + все файлы из R2 (covers, thumbs, originals) в одном ZIP"
          className="border border-gold/40 text-gold px-5 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:bg-gold hover:text-emerald-deep transition inline-flex items-center gap-2"
        >
          <Icon name="shield" size={13} /> Full export · ZIP
        </a>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-3 leading-relaxed">
        JSON-бэкап лёгкий (~MB), ссылается на R2 по URL.
        Full export тяжелее: пакует JSON + все картинки/файлы в один ZIP — настоящий
        self-contained backup, можно распаковать оффлайн через год.
      </p>
    </div>
  );
}
