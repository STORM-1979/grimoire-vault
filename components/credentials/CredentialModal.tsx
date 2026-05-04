"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Field } from "@/components/forms/Field";
import { StrengthDot } from "./StrengthDot";
import { classifyStrength, generatePassword } from "@/lib/crypto";

interface Props {
  onClose: () => void;
  onSubmit: (input: {
    service: string;
    url?: string | null;
    username: string;
    password: string;
    notes?: string | null;
    twoFactor: boolean;
    strength: "weak" | "medium" | "strong";
    tags: string[];
    pinned: boolean;
  }) => Promise<void>;
}

export function CredentialModal({ onClose, onSubmit }: Props) {
  const [form, setForm] = useState({
    service: "", url: "", username: "", password: "", notes: "",
    tags: "", twoFactor: false, pinned: false,
  });
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const liveStrength = classifyStrength(form.password);
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.type === "checkbox"
        ? (e.target as HTMLInputElement).checked
        : e.target.value });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.service.trim() || !form.password) return;
    setBusy(true);
    try {
      await onSubmit({
        service: form.service.trim(),
        url: form.url.trim() || null,
        username: form.username.trim(),
        password: form.password,
        notes: form.notes.trim() || null,
        twoFactor: form.twoFactor,
        strength: liveStrength,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        pinned: form.pinned,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between p-7 pb-5 border-b border-white/10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">№ 13 · Credentials</div>
            <h3 className="font-display text-[32px] font-medium leading-none">Сохранить аккаунт</h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">
              Шифруется на клиенте · сервер видит только blobs
            </div>
          </div>
          <button onClick={onClose} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          <Field label="Сервис" required>
            <input
              autoFocus
              type="text"
              value={form.service}
              onChange={set("service")}
              className="field-input"
              placeholder="GitHub, Vercel, Gmail…"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Username · email · телефон">
              <input type="text" value={form.username} onChange={set("username")} className="field-input" placeholder="user@example.com" />
            </Field>
            <Field label="URL">
              <input type="url" value={form.url} onChange={set("url")} className="field-input" placeholder="https://github.com" />
            </Field>
          </div>

          <Field
            label="Пароль"
            required
            hint={form.password
              ? `Сила: ${liveStrength.toUpperCase()} · ${form.password.length} символов`
              : "Используй генератор справа — 20 символов, все классы"}
          >
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showPwd ? "text" : "password"}
                  value={form.password}
                  onChange={set("password")}
                  className="field-input pr-12 font-mono"
                  autoComplete="new-password"
                  placeholder="••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 item-actions-btn"
                  title={showPwd ? "Скрыть" : "Показать"}
                >
                  <Icon name={showPwd ? "eyeOff" : "eye"} size={12} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, password: generatePassword(20) }))}
                className="border border-gold/40 text-gold px-3 py-2.5 rounded-lg font-mono text-[11px] uppercase tracking-widest hover:bg-gold/10 transition flex items-center gap-1.5"
                title="Сгенерировать пароль"
              >
                <Icon name="refresh" size={13} /> Generate
              </button>
            </div>
            {form.password && (
              <div className="mt-2"><StrengthDot strength={liveStrength} /></div>
            )}
          </Field>

          <Field label="Заметки">
            <textarea
              value={form.notes}
              onChange={set("notes")}
              className="field-textarea"
              placeholder="Recovery codes хранятся в 1Password · seed phrase в сейфе…"
            />
          </Field>

          <Field label="Теги (через запятую)" hint="Например: работа, банк, личное">
            <input type="text" value={form.tags} onChange={set("tags")} className="field-input" placeholder="tag1, tag2" />
          </Field>

          <label className="flex items-center gap-3 mt-2 mb-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-emerald-500"
              checked={form.twoFactor}
              onChange={(e) => setForm((f) => ({ ...f, twoFactor: e.target.checked }))}
            />
            <span className="text-[13px] text-ivory-dim flex items-center gap-1.5">
              <Icon name="shield" size={13} className="text-gold" /> Включён 2FA
            </span>
          </label>

          <label className="flex items-center gap-3 mt-2 mb-6 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 accent-emerald-500"
              checked={form.pinned}
              onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))}
            />
            <span className="text-[13px] text-ivory-dim flex items-center gap-1.5">
              <Icon name="pin" size={13} className="text-gold" /> Закрепить наверху
            </span>
          </label>

          {error && (
            <div className="mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
              <Icon name="x" size={12} /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-5 border-t border-white/10 -mx-7 px-7">
            <button
              type="button"
              onClick={onClose}
              className="border border-white/20 text-ivory-dim px-5 py-2.5 rounded-full font-medium tracking-tight hover:border-white/40 hover:text-ivory transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!form.service.trim() || !form.password || busy}
              className="bg-ivory text-emerald-950 px-6 py-2.5 rounded-full font-medium tracking-tight hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Icon name="lock" size={16} /> {busy ? "..." : "Сохранить аккаунт"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
