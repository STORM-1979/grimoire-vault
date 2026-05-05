"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icons/Icon";

/**
 * Email + password sign-in.
 *
 * Magic-link mode was removed — for a single-tenant personal vault
 * the email round-trip adds friction without buying meaningful safety,
 * and Supabase's password flow with PBKDF2 + email-confirmation is
 * already strong.  If you want to bring it back, restore the `Mode`
 * union and the `signInWithOtp` branch — git history has the old
 * version.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        router.refresh();
        router.push(next);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">Email</div>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-white/[0.04] border border-gold/20 rounded-lg px-4 py-3 text-ivory placeholder:text-ivory-mute/50 outline-none focus:border-gold transition"
        />
      </label>

      <label className="block">
        <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">Пароль</div>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full bg-white/[0.04] border border-gold/20 rounded-lg px-4 py-3 font-mono text-ivory placeholder:text-ivory-mute/50 outline-none focus:border-gold transition"
        />
      </label>

      {error && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-ivory text-emerald-950 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending ? "…" : "Войти"}
        {!pending && <Icon name="arrow" size={14} />}
      </button>

      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-ivory-mute pt-2">
        Email + пароль
      </p>
    </form>
  );
}
