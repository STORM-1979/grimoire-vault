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
        <input
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          minLength={8}
          className="w-full bg-white/[0.04] border border-gold/20 rounded-lg px-4 py-3 font-mono text-ivory placeholder:text-ivory-mute/50 outline-none focus:border-gold transition"
        />
      </label>

      <label className="block">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">Повтори пароль</div>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          minLength={8}
          className="w-full bg-white/[0.04] border border-gold/20 rounded-lg px-4 py-3 font-mono text-ivory placeholder:text-ivory-mute/50 outline-none focus:border-gold transition"
        />
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
