import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icons/Icon";
import { TelegramSettings } from "@/components/settings/TelegramSettings";
import { ReindexEmbeddings } from "@/components/settings/ReindexEmbeddings";
import { ExportVault } from "@/components/settings/ExportVault";
import { ImportVault } from "@/components/settings/ImportVault";
import { AdminStats } from "@/components/settings/AdminStats";
import { PushNotifications } from "@/components/settings/PushNotifications";
import { VaultsPanel } from "@/components/settings/VaultsPanel";
import { isOwnerEmail } from "@/lib/admin";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Server-side gate: anyone who isn't the configured owner doesn't
  // even see the AdminStats component in their HTML.  The route handler
  // re-checks on every fetch so this is purely a UI niceness, not a
  // security boundary.
  const isOwner = isOwnerEmail(user?.email);

  return (
    <div className="fade-in">
      <section className="max-w-[1080px] mx-auto px-10 pt-12 pb-8 border-b border-white/10">
        <div className="badge mb-6">Настройки</div>
        <h1 className="font-display text-[80px] font-light leading-[0.92] tracking-tightest">
          Конфигурация.
        </h1>
      </section>

      <section className="max-w-[1080px] mx-auto px-10 py-12 space-y-6">
        <div className="keynote rounded-2xl p-7">
          <div className="mb-5">
            <h3 className="font-display text-[28px] font-medium leading-none">Аккаунт</h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">
              Supabase Auth · активная сессия
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-[14px]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">Email</div>
              <div className="font-display text-[20px] font-medium">{user?.email ?? "—"}</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-2">User ID</div>
              <div className="font-mono text-[12px] text-ivory-dim break-all">{user?.id ?? "—"}</div>
            </div>
          </div>
        </div>

        <TelegramSettings />

        <VaultsPanel ownerUserId={user?.id ?? ""} />

        <PushNotifications />

        <ReindexEmbeddings />

        <ExportVault />

        <ImportVault />

        {isOwner && <AdminStats />}

        <div className="keynote rounded-2xl p-7">
          <div className="mb-5">
            <h3 className="font-display text-[28px] font-medium leading-none">Архитектура</h3>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mt-2">
              Обзор стека
            </div>
          </div>
          <table className="w-full">
            <tbody className="text-[15px]">
              <tr className="border-b border-white/8"><td className="py-3 font-mono text-[10px] uppercase tracking-widest text-ivory-mute w-32">Frontend</td><td className="py-3 font-display font-medium text-[18px]">Next.js 16 · App Router · RSC</td></tr>
              <tr className="border-b border-white/8"><td className="py-3 font-mono text-[10px] uppercase tracking-widest text-ivory-mute">UI</td><td className="py-3 font-display font-medium text-[18px]">Tailwind v4 · Fraunces · DM Sans</td></tr>
              <tr className="border-b border-white/8"><td className="py-3 font-mono text-[10px] uppercase tracking-widest text-ivory-mute">Backend</td><td className="py-3 font-display font-medium text-[18px]">Supabase · Postgres · Storage · RLS</td></tr>
              <tr className="border-b border-white/8"><td className="py-3 font-mono text-[10px] uppercase tracking-widest text-ivory-mute">Bot</td><td className="py-3 font-display font-medium text-[18px]">grammY · Telegram · webhook</td></tr>
              <tr><td className="py-3 font-mono text-[10px] uppercase tracking-widest text-ivory-mute">Hosting</td><td className="py-3 font-display font-medium text-[18px]">Vercel · Edge runtime · Cron</td></tr>
            </tbody>
          </table>
        </div>

        <div className="keynote rounded-2xl p-7">
          <div className="mb-3 flex items-center gap-3">
            <Icon name="shield" size={20} className="text-gold" />
            <h3 className="font-display text-[28px] font-medium leading-none">Статус разработки</h3>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-4">
            v1.0.0 · production
          </div>
          <ul className="text-[14px] text-ivory-dim space-y-1.5 list-disc list-inside">
            <li>Все фазы миграции (1-6) — завершены</li>
            <li>Семантический поиск + WebP-транскодинг — в проде</li>
            <li>⌘K Command Palette + vim keyboard nav — в проде</li>
            <li>Inbox triage + bulk-операции — в проде</li>
            <li>Export / Import + Owner-only ops layer — в проде</li>
            <li>Web Push + Shared vaults + Upstash rate limit — в проде</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
