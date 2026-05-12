"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Field } from "@/components/forms/Field";
import { StrengthDot } from "./StrengthDot";
import { classifyStrength, generatePassword } from "@/lib/crypto";
import { ORPHAN_OWNER } from "@/lib/credentials-owners";
import type { CredentialDecrypted } from "@/lib/types";

interface Props {
  /** When set, the modal opens in edit mode: pre-fills the form
   *  with this record's decrypted values, swaps the heading, and
   *  routes submit through onSubmit with the same shape — the
   *  caller decides whether to call create() or update(). */
  initial?: CredentialDecrypted | null;
  /** Distinct owner-collection names that already exist in the
   *  user's vault — rendered as chip buttons.  The "Новая…" input
   *  below lets the user type a fresh name on the fly. */
  ownerOptions: string[];
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
    owner?: string | null;
  }) => Promise<void>;
}

export function CredentialModal({ initial, ownerOptions, onClose, onSubmit }: Props) {
  const isEdit = !!initial;
  // Default the owner to the orphan-bucket label so the picker
  // starts in a valid required-field state ("Без коллекции" is
  // always present in ownerOptions via distinctOwners()).  The
  // user can override before saving.
  const [form, setForm] = useState(() =>
    initial
      ? {
          service: initial.service,
          url: initial.url ?? "",
          username: initial.username,
          password: initial.password,
          notes: initial.notes ?? "",
          tags: initial.tags.join(", "),
          twoFactor: initial.twoFactor,
          pinned: initial.pinned,
          owner: initial.owner?.trim() || ORPHAN_OWNER,
        }
      : {
          service: "", url: "", username: "", password: "", notes: "",
          tags: "", twoFactor: false, pinned: false, owner: ORPHAN_OWNER,
        }
  );
  // Inline "+ Новая коллекция" input — empty by default, becomes
  // the owner value on Enter.
  const [newOwnerDraft, setNewOwnerDraft] = useState("");
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
    // Service + collection are mandatory.  Password stays optional
    // (SSO / passkey / email-link accounts have nothing to type
    // into that field).
    if (!form.service.trim() || !form.owner.trim()) return;
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
        owner: form.owner.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setBusy(false);
    }
  };

  // See EditEntryModal for the rationale — closing on overlay click
  // alone caused mid-edit losses when text-selection drags ended
  // outside the modal.
  const downOnOverlay = useRef(false);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (downOnOverlay.current && e.target === e.currentTarget) onClose();
        downOnOverlay.current = false;
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between p-7 pb-5 border-b border-white/10">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2">
              № 13 · Credentials{isEdit ? " · Edit" : ""}
            </div>
            <h3 className="font-display text-[32px] font-medium leading-none">
              {isEdit ? "Редактировать аккаунт" : "Сохранить аккаунт"}
            </h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2 truncate max-w-md">
              {isEdit
                ? initial?.service
                : "Шифруется на клиенте · сервер видит только blobs"}
            </div>
          </div>
          <button onClick={onClose} className="item-actions-btn" title="Закрыть (Esc)">
            <Icon name="x" size={14} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-7">
          <Field
            label="Коллекция"
            required
            hint="Выбери существующую или создай новую — без коллекции запись не сохранить"
          >
            {/* Chip-row picker — every existing collection rendered
                as a chip, plus an inline "+ Новая коллекция" input
                so the user can spin up a new bucket on the fly.
                Same visual language as the filter strip above the
                table on the credentials view. */}
            <div className="flex flex-wrap gap-2 items-center">
              {ownerOptions.map((name) => {
                const active = form.owner === name;
                const isOrphan = name === ORPHAN_OWNER;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, owner: name }))}
                    className={
                      "font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full transition " +
                      (isOrphan ? "italic " : "") +
                      (active
                        ? "bg-gold text-emerald-deep"
                        : "border border-white/15 text-ivory-mute hover:text-gold hover:border-gold/40")
                    }
                  >
                    {name}
                  </button>
                );
              })}
              {/* + Новая коллекция — type a name + Enter / blur
                  commits it as the active owner.  The name only
                  becomes a permanent option after the credential
                  saves, but the chip strip on the view re-derives
                  ownerOptions from the live items list anyway. */}
              <input
                type="text"
                value={newOwnerDraft}
                onChange={(e) => setNewOwnerDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const name = newOwnerDraft.trim();
                    if (name) {
                      setForm((f) => ({ ...f, owner: name }));
                      setNewOwnerDraft("");
                    }
                  } else if (e.key === "Escape") {
                    setNewOwnerDraft("");
                  }
                }}
                onBlur={() => {
                  const name = newOwnerDraft.trim();
                  if (name) {
                    setForm((f) => ({ ...f, owner: name }));
                    setNewOwnerDraft("");
                  }
                }}
                placeholder="+ новая коллекция"
                className="font-mono text-[11px] uppercase tracking-widest px-3.5 py-2 rounded-full bg-transparent border border-emerald-300/30 text-emerald-200 placeholder:text-emerald-200/50 hover:border-emerald-300 focus:border-emerald-300 focus:outline-none min-w-[180px] transition"
              />
            </div>
          </Field>

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
            hint={form.password
              ? `Сила: ${liveStrength.toUpperCase()} · ${form.password.length} символов`
              : "Оставь пустым, если вход через SSO / email-link / passkey — иначе используй генератор справа"}
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
              disabled={!form.service.trim() || !form.owner.trim() || busy}
              className="bg-ivory text-emerald-950 px-6 py-2.5 rounded-full font-medium tracking-tight hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              <Icon name={isEdit ? "check" : "lock"} size={16} /> {busy ? "..." : isEdit ? "Сохранить" : "Сохранить аккаунт"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
