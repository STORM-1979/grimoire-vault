"use client";

import { CredentialRow } from "./CredentialRow";
import type { CredentialDecrypted } from "@/lib/types";

interface Props {
  items: CredentialDecrypted[];
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onEdit?: (item: CredentialDecrypted) => void;
}

export function CredentialsTable({ items, onTogglePin, onDelete, onEdit }: Props) {
  return (
    <div className="bg-emerald-deep/40 border border-white/8 rounded-xl overflow-hidden">
      <div className="grid grid-cols-[44px_2fr_2.5fr_2.5fr_120px_120px] gap-4 items-center px-4 py-3 border-b border-white/10 bg-white/[0.02]">
        <div />
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold">Service</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold">Username</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold">Password</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold">Strength</div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-gold text-right">Updated</div>
      </div>
      {items.map((it) => (
        <CredentialRow key={it.id} item={it} onTogglePin={onTogglePin} onDelete={onDelete} onEdit={onEdit} />
      ))}
      {items.length === 0 && (
        <div className="text-center py-16 text-ivory-mute font-light italic">— ничего не найдено —</div>
      )}
    </div>
  );
}
