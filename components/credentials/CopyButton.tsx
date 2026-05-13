"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { copyToClipboard } from "@/lib/clipboard";

interface Props {
  value: string | null | undefined;
  label?: string;
  /** Optional: clear clipboard after N ms (1Password-style). */
  clearAfterMs?: number;
}

export function CopyButton({ value, label = "value", clearAfterMs = 30000 }: Props) {
  const [copied, setCopied] = useState(false);

  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!value) return;
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    if (clearAfterMs > 0) {
      setTimeout(() => { copyToClipboard(""); }, clearAfterMs);
    }
  };

  const disabled = !value;
  return (
    <button
      onClick={handle}
      disabled={disabled}
      className="item-actions-btn disabled:opacity-30 disabled:cursor-not-allowed"
      title={`Копировать ${label}${clearAfterMs > 0 ? ` (auto-clear через ${clearAfterMs / 1000}s)` : ""}`}
      aria-label={copied ? `${label} скопирован` : `Копировать ${label}`}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
    </button>
  );
}
