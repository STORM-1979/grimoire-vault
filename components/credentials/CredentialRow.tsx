"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { CopyButton } from "./CopyButton";
import { StrengthDot } from "./StrengthDot";
import type { CredentialDecrypted } from "@/lib/types";

interface Props {
  item: CredentialDecrypted;
  onTogglePin: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

const initial = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

export function CredentialRow({ item, onTogglePin, onDelete }: Props) {
  const [revealed, setRevealed] = useState(false);
  const masked = "•".repeat(Math.min(16, Math.max(8, item.password.length)));

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onTogglePin(item.id);
  };
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm(`Удалить «${item.service}»?`)) onDelete(item.id);
  };

  return (
    <div className="cred-row group relative grid grid-cols-[44px_2fr_2.5fr_2.5fr_120px_120px] gap-4 items-center px-4 py-3.5 border-b border-white/5 hover:bg-white/[0.03] transition-colors">
      <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button onClick={handlePin} className={`item-actions-btn ${item.pinned ? "active" : ""}`} title={item.pinned ? "Открепить" : "Закрепить"}>
          <Icon name={item.pinned ? "pinFilled" : "pin"} size={13} />
        </button>
        <button onClick={handleDelete} className="item-actions-btn danger" title="Удалить">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-700 to-emerald-deep border border-gold/20 flex items-center justify-center font-display text-[18px] font-medium text-gold">
        {initial(item.service)}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-[15px] truncate">{item.service}</h4>
          {item.pinned && <Icon name="pinFilled" size={11} className="text-gold flex-shrink-0" />}
          {item.twoFactor && (
            <span className="tag-emerald inline-flex items-center gap-1">
              <Icon name="shield" size={10} /> 2FA
            </span>
          )}
        </div>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[10px] text-ivory-mute/70 truncate block mt-0.5 hover:text-gold transition"
          >
            {item.url.replace(/^https?:\/\//, "")}
          </a>
        )}
        {item.notes && (
          <p className="text-[12px] text-ivory-dim/80 mt-1 leading-snug font-light truncate">{item.notes}</p>
        )}
      </div>

      <div className="min-w-0 flex items-center gap-2">
        <span className="font-mono text-[13px] truncate text-ivory-dim flex-1 select-all">{item.username}</span>
        <CopyButton value={item.username} label="username" />
      </div>

      <div className="min-w-0 flex items-center gap-2">
        <span className="font-mono text-[13px] truncate text-ivory-dim flex-1 select-all">
          {revealed ? item.password : masked}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setRevealed((r) => !r); }}
          className="item-actions-btn"
          title={revealed ? "Скрыть" : "Показать"}
        >
          <Icon name={revealed ? "eyeOff" : "eye"} size={12} />
        </button>
        <CopyButton value={item.password} label="password" />
      </div>

      <StrengthDot strength={item.strength} />

      <div className="text-right font-mono text-[10px] uppercase tracking-widest text-ivory-mute">
        <div>{item.updatedAt.slice(0, 10)}</div>
        <div className="flex items-center gap-1 flex-wrap mt-1.5 justify-end">
          {item.tags.slice(0, 2).map((t) => <span key={t} className="tag-soft">{t}</span>)}
        </div>
      </div>
    </div>
  );
}
