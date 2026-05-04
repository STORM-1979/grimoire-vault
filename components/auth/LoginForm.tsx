"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icons/Icon";

type Mode = "magic" | "password";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const supabase = createClient();
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) setError(error.message);
        else setInfo("Ссылка отправлена. Проверь почту.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
        } else {
          router.refresh();
          router.push(next);
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-1 p-1 rounded-full border border-white/10 bg-white/[0.02]">
        <button
          type="button"
          onClick={() => setMode("magic")}
          className={`flex-1 py-2 text-[11px] font-mono uppercase tracking-widest rounded-full transition ${
            mode === "magic" ? "bg-gold text-emerald-deep" : "text-ivory-dim hover:text-gold"
          }`}
        >
          Magic link
        </button>
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`flex-1 py-2 text-[11px] font-mono uppercase tracking-widest rounded-full transition ${
            mode === "password" ? "bg-gold text-emerald-deep" : "text-ivory-dim hover:text-gold"
          }`}
        >
          Password
        </button>
      </div>

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

      {mode === "password" && (
        <label className="block">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-1.5">Password</div>
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
      )}

      {error && (
        <div className="font-mono text-[11px] text-red-400 flex items-center gap-2">
          <Icon name="x" size={12} /> {error}
        </div>
      )}
      {info && (
        <div className="font-mono text-[11px] text-emerald-200 flex items-center gap-2">
          <Icon name="check" size={12} /> {info}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-ivory text-emerald-950 py-3 rounded-full font-medium tracking-tight hover:bg-emerald-100 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {pending ? "…" : mode === "magic" ? "Прислать ссылку" : "Войти"}
        {!pending && <Icon name="arrow" size={14} />}
      </button>

      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-ivory-mute pt-2">
        {mode === "magic"
          ? "На email придёт одноразовая ссылка"
          : "Используй классический логин-пароль"}
      </p>
    </form>
  );
}
