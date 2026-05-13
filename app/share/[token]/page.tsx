import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { rowToEntry } from "@/lib/data/mappers";
import { getCategory } from "@/lib/categories";
import { Icon } from "@/components/icons/Icon";
import { formatDateTime } from "@/lib/utils";
import { sha256Hex } from "@/lib/hash";

/**
 * Public read-only view of one entry, accessible without login.
 *
 * Token is hashed and matched against share_links.token_hash; lookup
 * uses the service-role client so the public visitor doesn't need
 * a Supabase session. Expired links 404. Hit count is bumped on
 * every successful render so the owner can see usage.
 */
export default async function SharedEntryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const hash = await sha256Hex(token);
  const svc = createServiceClient();

  const { data: link } = await svc
    .from("share_links")
    .select("id, entry_id, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!link) notFound();
  if (link.expires_at && new Date(link.expires_at) < new Date()) notFound();

  const { data: row } = await svc
    .from("entries").select("*").eq("id", link.entry_id).maybeSingle();
  if (!row) notFound();
  const entry = rowToEntry(row);
  const cat = getCategory(entry.categoryId);

  // Fire-and-forget hit counter bump via an atomic SQL function so
  // two concurrent visitors don't lose increments to a read/modify/
  // write race.  Not awaited — public render shouldn't wait on a
  // counter.  Earlier draft cast `link.hit_count` through an unknown
  // shim because the SELECT above never asked for the field, which
  // meant the counter was reset to 1 on every view.
  void svc.rpc("bump_share_hit", {
    p_link_id: link.id,
    p_now: new Date().toISOString(),
  });

  return (
    <div className="min-h-screen bg-emerald-deep text-ivory">
      <header className="border-b border-white/10">
        <div className="max-w-[900px] mx-auto px-10 py-4 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-widest text-gold">
            Grimoire Vault · share-link
          </div>
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute hover:text-gold transition"
          >
            Свой vault →
          </Link>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-10 py-16 fade-in">
        <div className="flex items-end gap-7 mb-7">
          <div className="text-emerald-200 flex-shrink-0">
            {cat && <Icon name={cat.icon} size={56} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
              {cat ? `№ ${cat.no} · ${cat.en}` : entry.categoryId}
              <span className="ml-3 text-ivory-mute normal-case tracking-normal">
                · добавлено {formatDateTime(entry.createdAt)}
              </span>
            </div>
            <h1 className="font-display text-[44px] font-light leading-[0.98] tracking-tightest mb-3">
              {entry.title}
            </h1>
            {entry.description && (
              <p className="text-[15px] text-ivory-dim leading-relaxed font-light">
                {entry.description}
              </p>
            )}
          </div>
        </div>

        {entry.tags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-8">
            {entry.tags.map((t) => (
              <span key={t} className="tag-soft">{t}</span>
            ))}
          </div>
        )}

        {entry.coverUrl && /^https?:/.test(entry.coverUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.coverUrl}
            alt=""
            className="w-full rounded-xl border border-white/10 mb-8"
            loading="lazy"
          />
        )}

        {entry.body && (
          <div className="prose prose-invert max-w-none">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ivory-mute mb-3">
              Содержимое
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[13px] text-ivory-dim leading-relaxed bg-white/[0.02] border border-white/10 rounded-lg p-5">
              {entry.body}
            </pre>
          </div>
        )}

        {entry.url && /^https?:/.test(entry.url) && (
          <div className="mt-8">
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] uppercase tracking-widest px-4 py-2 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition inline-flex items-center gap-2"
            >
              <Icon name="arrow" size={11} /> Открыть источник
            </a>
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 mt-16">
        <div className="max-w-[900px] mx-auto px-10 py-6 font-mono text-[10px] uppercase tracking-widest text-ivory-mute/70 text-center">
          read-only share · hosted via Grimoire Vault
        </div>
      </footer>
    </div>
  );
}

