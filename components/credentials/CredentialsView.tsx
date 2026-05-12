"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useMasterKey } from "@/lib/hooks/useMasterKey";
import { useCredentials } from "@/lib/hooks/useCredentials";
import { UnlockGate } from "./UnlockGate";
import { CredentialsTable } from "./CredentialsTable";
import { CredentialModal } from "./CredentialModal";
import { PrintableCredentials } from "./PrintableCredentials";
import type { CredentialDecrypted } from "@/lib/types";

export function CredentialsView() {
  const mk = useMasterKey();
  const creds = useCredentials(mk.key);
  const [showAdd, setShowAdd] = useState(false);
  // null  → modal closed
  // record → edit mode, pre-fill with this decrypted row
  const [editing, setEditing] = useState<CredentialDecrypted | null>(null);

  if (!mk.ready) {
    return (
      <section className="text-center py-32 text-ivory-mute font-mono text-[11px] uppercase tracking-widest">
        Загружаю vault…
      </section>
    );
  }

  if (!mk.unlocked) {
    return (
      <UnlockGate
        isSetup={mk.isSetup}
        busy={mk.busy}
        error={mk.error}
        onSetup={mk.setup}
        onUnlock={mk.unlock}
      />
    );
  }

  const pinned = creds.items.filter((c) => c.pinned);
  const others = creds.items.filter((c) => !c.pinned);

  return (
    <div>
      {/* Stats + actions */}
      <div className="max-w-[1480px] mx-auto px-10 -mt-24 mb-8 flex items-end justify-end gap-3">
        <div className="keynote text-center min-w-[110px] p-4">
          <div className="font-display text-[32px] font-light text-gold leading-none">{creds.items.length}</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Записей</div>
        </div>
        <div className="keynote text-center min-w-[110px] p-4">
          <div className="font-display text-[32px] font-light text-gold leading-none">{pinned.length}</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Закреплено</div>
        </div>
        <button
          onClick={() => {
            // Hard confirmation — paper copies of passwords are
            // irreversible disclosures.  The user has to explicitly
            // acknowledge before the print dialog comes up.
            if (creds.items.length === 0) return;
            const ok = confirm(
              `Распечатать все пароли (${creds.items.length} шт.)?\n\nОни появятся в виде открытого текста.  Не оставляй распечатку без присмотра — после использования храни в сейфе или уничтожь.`,
            );
            if (!ok) return;
            // Defer to next tick so the confirm dialog fully closes
            // before the browser print preview pops up.
            setTimeout(() => window.print(), 50);
          }}
          disabled={creds.items.length === 0}
          title="Распечатать все пароли в открытом виде"
          className="border border-white/30 text-ivory-dim px-4 py-3 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-gold hover:text-gold disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
        >
          <Icon name="documents" size={13} /> Распечатать
        </button>
        <button
          onClick={mk.lock}
          title="Заблокировать vault"
          className="border border-white/30 text-ivory-dim px-4 py-3 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-gold hover:text-gold transition flex items-center gap-2"
        >
          <Icon name="lock" size={13} /> Запереть
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-ivory text-emerald-950 px-5 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition flex items-center gap-2"
        >
          <Icon name="add" size={16} /> Добавить пароль
        </button>
      </div>

      {/* Print-only sheet — invisible on screen via `hidden`
          Tailwind class + the @media print rules in globals.css
          make it the sole visible element when window.print() fires. */}
      <PrintableCredentials items={creds.items} />

      {showAdd && (
        <CredentialModal
          onClose={() => setShowAdd(false)}
          onSubmit={async (input) => { await creds.create(input); }}
        />
      )}

      {editing && (
        <CredentialModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => { await creds.update(editing.id, input); }}
        />
      )}

      {/* Security warning */}
      <section className="max-w-[1480px] mx-auto px-10 pt-2">
        <div className="flex items-start gap-4 p-5 rounded-xl border border-gold/30 bg-gold/[0.04]">
          <div className="text-gold flex-shrink-0 mt-0.5"><Icon name="shield" size={22} /></div>
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">Шифрование</div>
            <p className="text-[13.5px] text-ivory-dim leading-snug font-light">
              Пароли зашифрованы на клиенте через <span className="text-ivory">PBKDF2-SHA256 (600k итераций)</span> →{" "}
              <span className="text-ivory">AES-GCM-256</span> с уникальным IV на каждое поле. Сервер видит только base64-blobs.
              Мастер-пароль живёт в <span className="text-ivory">sessionStorage</span> до закрытия вкладки.
            </p>
          </div>
        </div>
      </section>

      {creds.error && (
        <div className="max-w-[1480px] mx-auto px-10 mt-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {creds.error}
        </div>
      )}

      {pinned.length > 0 && (
        <section className="max-w-[1480px] mx-auto px-10 py-8">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4 flex items-center gap-2">
            <Icon name="pin" size={14} /> Закреплено
          </div>
          <CredentialsTable
            items={pinned}
            onTogglePin={creds.togglePin}
            onDelete={creds.remove}
            onEdit={setEditing}
          />
        </section>
      )}

      <section className="max-w-[1480px] mx-auto px-10 py-8">
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4">Все записи · {others.length}</div>
        <CredentialsTable
          items={others}
          onTogglePin={creds.togglePin}
          onDelete={creds.remove}
          onEdit={setEditing}
        />
      </section>

      {creds.items.length === 0 && !creds.loading && (
        <section className="max-w-[1480px] mx-auto px-10 py-32 text-center">
          <div className="text-ivory-mute font-light italic mb-4">— vault пуст —</div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
            Жми «Добавить пароль» чтобы сохранить первый аккаунт
          </div>
        </section>
      )}
    </div>
  );
}
