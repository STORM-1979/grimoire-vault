"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { classifyStrength } from "@/lib/crypto";

interface Props {
  isSetup: boolean;
  busy: boolean;
  error: string | null;
  onSetup: (password: string) => Promise<void>;
  onUnlock: (password: string) => Promise<void>;
}

export function UnlockGate({ isSetup, busy, error, onSetup, onUnlock }: Props) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show, setShow] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const strength = classifyStrength(pwd);
  const colour = strength === "strong" ? "var(--color-emerald-400)" : strength === "medium" ? "var(--color-gold)" : "#f87171";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    try {
      if (isSetup) {
        await onUnlock(pwd);
      } else {
        if (pwd !== pwd2) {
          setLocalError("Пароли не совпадают");
          return;
        }
        if (pwd.length < 10) {
          setLocalError("Минимум 10 символов");
          return;
        }
        await onSetup(pwd);
      }
      setPwd("");
      setPwd2("");
    } catch {
      // surfaced via `error`
    }
  };

  return (
    <section className="max-w-[640px] mx-auto px-10 py-16">
      <div className="text-center mb-8">
        <div className="inline-flex w-20 h-20 items-center justify-center rounded-full border border-gold/40 mb-6">
          <Icon name="lock" size={32} className="text-gold" />
        </div>
        <div className="badge mb-4">{isSetup ? "Vault locked" : "First-time setup"}</div>
        <h1 className="font-display italic font-medium text-[42px] text-ivory leading-none tracking-tightest">
          {isSetup ? "Введи master password" : "Создай master password"}
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-3">
          Используется ТОЛЬКО для шифрования паролей. Не путай с email-паролем.
        </p>
      </div>

      <form onSubmit={submit} className="keynote rounded-2xl p-8">
        <label className="block mb-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">
            Master password {!isSetup && "(минимум 10 символов)"}
          </div>
          <div className="relative">
            <input
              autoFocus
              type={show ? "text" : "password"}
              autoComplete={isSetup ? "current-password" : "new-password"}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="field-input pr-12 font-mono text-[14px]"
              placeholder="••••••••••"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 item-actions-btn"
              title={show ? "Скрыть" : "Показать"}
            >
              <Icon name={show ? "eyeOff" : "eye"} size={12} />
            </button>
          </div>
          {!isSetup && pwd && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="w-1.5 h-3 rounded-sm"
                    style={{
                      background: n <= (strength === "strong" ? 3 : strength === "medium" ? 2 : 1)
                        ? colour
                        : "rgba(250,246,233,.12)",
                    }}
                  />
                ))}
              </div>
              <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: colour }}>
                {strength}
              </span>
            </div>
          )}
        </label>

        {!isSetup && (
          <label className="block mb-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">
              Подтверждение
            </div>
            <input
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              className="field-input font-mono text-[14px]"
              placeholder="••••••••••"
            />
          </label>
        )}

        {(error || localError) && (
          <div className="mb-4 font-mono text-[11px] text-red-400 flex items-center gap-2">
            <Icon name="x" size={12} /> {localError ?? error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !pwd}
          className="w-full bg-ivory text-emerald-950 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 disabled:opacity-50 transition flex items-center justify-center gap-2"
        >
          {busy ? "…" : isSetup ? "Разблокировать vault" : "Создать мастер-пароль"}
          {!busy && <Icon name="arrow" size={14} />}
        </button>

        {!isSetup && (
          <div className="mt-6 p-4 border border-gold/20 rounded-lg bg-gold/[0.04]">
            <div className="font-mono text-[10px] uppercase tracking-widest text-gold mb-2 flex items-center gap-2">
              <Icon name="shield" size={11} /> Важно
            </div>
            <p className="text-[12.5px] text-ivory-dim leading-snug">
              Этот пароль <span className="text-ivory">никогда</span> не уходит на сервер. Если ты его
              забудешь — все сохранённые credentials станут недешифруемыми.
              Запиши в надёжное место (например, в обычный 1Password как backup).
            </p>
          </div>
        )}
      </form>
    </section>
  );
}
