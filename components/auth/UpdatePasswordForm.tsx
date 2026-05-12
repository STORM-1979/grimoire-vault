"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icons/Icon";

/**
 * "Set new password" form rendered after the user lands on
 * /auth/update-password from a recovery email.  Supabase's recovery
 * flow leaves the browser in a one-shot session keyed off the
 * exchanged code; calling auth.updateUser({ password }) on that
 * session permanently rotates the credential.
 *
 * 8-char minimum mirrors the Supabase project setting; tweak both
 * places together if we ever raise the bar.
 */
export function UpdatePasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // One reveal-toggle for BOTH fields — when the user wants to
  // see what they typed, they want to see both at once.  Avoids
  // the awkward "showing one but not the other" state where they'd
  // have to flip twice to verify a match.
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Минимум 8 символов");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return;
      }
      setSuccess(true);
      // Brief pause to show the success state, then bounce home —
      // the recovery session is already a logged-in session, so we
      // don't need to redirect through /login.
      setTimeout(() => {
        router.refresh();
        router.push("/");
      }, 800);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">Новый пароль</div>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            minLength={8}
            className="w-full bg-white/[0.04] border border-gold/20 rounded-lg px-4 py-3 pr-12 font-mono text-ivory placeholder:text-ivory-mute/50 outline-none focus:border-gold transition"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 item-actions-btn"
            title={showPassword ? "Скрыть пароль" : "Показать пароль"}
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} size={13} />
          </button>
        </div>
      </label>

      <label className="block">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">Повтори пароль</div>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            minLength={8}
            className="w-full bg-white/[0.04] border border-gold/20 rounded-lg px-4 py-3 pr-12 font-mono text-ivory placeholder:text-ivory-mute/50 outline-none focus:border-gold transition"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 item-actions-btn"
            title={showPassword ? "Скрыть пароль" : "Показать пароль"}
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} size={13} />
          </button>
        </div>
      </label>

      {error && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}
      {success && (
        <div className="font-mono text-[11px] text-emerald-300 flex items-center gap-2">
          <Icon name="check" size={12} /> Пароль обновлён · перехожу к записям…
        </div>
      )}

      <button
        type="submit"
        disabled={pending || success}
        className="w-full bg-ivory text-emerald-950 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending ? "…" : "Сохранить"}
        {!pending && <Icon name="check" size={14} />}
      </button>
    </form>
  );
}
