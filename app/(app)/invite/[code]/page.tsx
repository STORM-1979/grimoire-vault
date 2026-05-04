import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { acceptInvite } from "@/lib/data/vaults";
import { Icon } from "@/components/icons/Icon";

/**
 * Accept-invite landing page.
 *
 * If the visitor isn't logged in, the (app) layout's auth-guard already
 * redirects them to /login?next=/invite/<code>; after they sign in
 * they land back here and the server component finishes the join.
 *
 * On success: confirmation card with a link to the vault's home.
 * On any soft failure (expired, already used, not found): explanation.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${code}`)}`);

  let vault: { id: string; name: string } | null = null;
  let already = false;
  let problem: string | null = null;

  try {
    const r = await acceptInvite(user.id, code);
    vault = { id: r.vault.id, name: r.vault.name };
    already = r.alreadyMember;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invite failed";
    problem = msg;

    // Try to surface vault name even on already-used invite (so the user
    // sees what they were trying to join, even if it's redundant).
    try {
      const svc = createServiceClient();
      const { data: inv } = await svc.from("vault_invites").select("vault_id").eq("code", code).maybeSingle();
      if (inv) {
        const { data: v } = await svc.from("vaults").select("id, name").eq("id", inv.vault_id).maybeSingle();
        if (v) vault = { id: v.id, name: v.name };
      }
    } catch { /* best-effort */ }
  }

  return (
    <div className="fade-in min-h-[60vh] flex items-center justify-center px-6">
      <div className="keynote rounded-2xl p-8 max-w-md w-full text-center">
        {!problem ? (
          <>
            <div className="w-12 h-12 rounded-full bg-gold/15 mx-auto flex items-center justify-center mb-4">
              <Icon name="check" size={20} className="text-gold" />
            </div>
            <h1 className="font-display text-[32px] font-light leading-tight mb-2">
              {already ? "Уже внутри" : "Добро пожаловать"}
            </h1>
            <p className="text-[14px] text-ivory-dim leading-snug font-light mb-6">
              {already
                ? <>Ты уже состоишь в <em>«{vault?.name}»</em>.</>
                : <>Тебя добавили в <em>«{vault?.name}»</em> как editor. Можешь добавлять и редактировать записи.</>}
            </p>
            <div className="flex items-center justify-center gap-2">
              <Link
                href="/"
                className="bg-ivory text-emerald-950 px-5 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:bg-emerald-100 transition inline-flex items-center gap-2"
              >
                <Icon name="arrow" size={13} /> Открыть vault
              </Link>
              <Link
                href="/settings"
                className="border border-white/15 text-ivory-mute px-4 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:border-gold hover:text-gold transition"
              >
                Settings
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-red-400/15 mx-auto flex items-center justify-center mb-4">
              <Icon name="x" size={20} className="text-red-300" />
            </div>
            <h1 className="font-display text-[32px] font-light leading-tight mb-2">Не получилось</h1>
            <p className="text-[14px] text-ivory-dim leading-snug font-light mb-2">
              {problem}
            </p>
            {vault && (
              <p className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-6">
                Vault: «{vault.name}»
              </p>
            )}
            <Link
              href="/"
              className="border border-white/15 text-ivory-mute px-4 py-2.5 rounded-full font-medium tracking-tight text-[13px] hover:border-gold hover:text-gold transition inline-flex items-center gap-2"
            >
              <Icon name="arrow" size={13} /> На главную
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
