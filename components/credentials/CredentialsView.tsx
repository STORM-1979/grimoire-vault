"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useMasterKey } from "@/lib/hooks/useMasterKey";
import { useCredentials } from "@/lib/hooks/useCredentials";
import { UnlockGate } from "./UnlockGate";
import { CredentialsTable } from "./CredentialsTable";
import { CredentialModal } from "./CredentialModal";

export function CredentialsView() {
  const mk = useMasterKey();
  const creds = useCredentials(mk.key);
  const [showAdd, setShowAdd] = useState(false);

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
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Items</div>
        </div>
        <div className="keynote text-center min-w-[110px] p-4">
          <div className="font-display text-[32px] font-light text-gold leading-none">{pinned.length}</div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-ivory-mute mt-1">Pinned</div>
        </div>
        <button
          onClick={mk.lock}
          title="Lock vault"
          className="border border-white/30 text-ivory-dim px-4 py-3 rounded-full font-mono text-[10px] uppercase tracking-widest hover:border-gold hover:text-gold transition flex items-center gap-2"
        >
          <Icon name="lock" size={13} /> Lock
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-ivory text-emerald-950 px-5 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition flex items-center gap-2"
        >
          <Icon name="add" size={16} /> Add Credential
        </button>
      </div>

      {showAdd && (
        <CredentialModal
          onClose={() => setShowAdd(false)}
          onSubmit={async (input) => { await creds.create(input); }}
        />
      )}

      {/* Security warning */}
      <section className="max-w-[1480px] mx-auto px-10 pt-2">
        <div className="flex items-start gap-4 p-5 rounded-xl border border-gold/30 bg-gold/[0.04]">
          <div className="text-gold flex-shrink-0 mt-0.5"><Icon name="shield" size={22} /></div>
          <div className="flex-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-1">Encryption</div>
            <p className="text-[13.5px] text-ivory-dim leading-snug font-light">
              Пароли зашифрованы на клиенте через <span className="text-ivory">PBKDF2-SHA256 (600k iterations)</span> →{" "}
              <span className="text-ivory">AES-GCM-256</span> с уникальным IV на каждое поле. Сервер видит только base64-blobs.
              Master password живёт в <span className="text-ivory">sessionStorage</span> до закрытия вкладки.
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
            <Icon name="pin" size={14} /> Pinned
          </div>
          <CredentialsTable items={pinned} onTogglePin={creds.togglePin} onDelete={creds.remove} />
        </section>
      )}

      <section className="max-w-[1480px] mx-auto px-10 py-8">
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-4">All entries · {others.length}</div>
        <CredentialsTable items={others} onTogglePin={creds.togglePin} onDelete={creds.remove} />
      </section>

      {creds.items.length === 0 && !creds.loading && (
        <section className="max-w-[1480px] mx-auto px-10 py-32 text-center">
          <div className="text-ivory-mute font-light italic mb-4">— vault пуст —</div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
            Жми «Add Credential» чтобы сохранить первый аккаунт
          </div>
        </section>
      )}
    </div>
  );
}
