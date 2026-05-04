import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwnerEmail } from "@/lib/admin";
import { Icon } from "@/components/icons/Icon";
import { HealthProbes } from "@/components/admin/HealthProbes";

/**
 * /admin/health — owner-only "is everything talking to everything" page.
 *
 * Server-side gate keeps non-owners off the page entirely (404-shaped
 * redirect to home). The client component then drives the probe via
 * /api/admin/health which double-checks the same gate.
 */
export default async function HealthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isOwnerEmail(user?.email)) redirect("/");

  return (
    <div className="fade-in">
      <section className="max-w-[980px] mx-auto px-10 pt-12 pb-8 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Главная</Link>
          <span>/</span>
          <Link href="/settings" className="hover:text-gold">Настройки</Link>
          <span>/</span>
          <span className="text-gold">Admin · Health</span>
        </div>

        <div className="flex items-end justify-between gap-8 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2 flex items-center gap-2">
              <Icon name="shield" size={11} /> Только для владельца · проверка зависимостей
            </div>
            <h1 className="font-display text-[72px] font-light leading-[0.92] tracking-tightest">
              Состояние <span className="italic text-gold">системы</span>
            </h1>
            <p className="text-[15px] text-ivory-dim mt-3 max-w-2xl">
              Дёргает каждую внешнюю зависимость по разу — Supabase REST,
              pgvector RPC, R2 bucket, Telegram getMe/getWebhookInfo —
              и показывает round-trip latency. Запустить после деплоя,
              когда поменял env-переменные, или просто чтобы убедиться,
              что ничто не отвалилось.
            </p>
          </div>
        </div>
      </section>

      <HealthProbes />
    </div>
  );
}
