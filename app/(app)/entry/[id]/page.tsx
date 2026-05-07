import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rowToEntry } from "@/lib/data/mappers";
import { listAttachments } from "@/lib/data/attachments";
import { getCategory } from "@/lib/categories";
import { Icon } from "@/components/icons/Icon";
import { formatDateTime } from "@/lib/utils";
import { EntryBoard } from "@/components/entry/EntryBoard";
import { EntryPrimaryView } from "@/components/entry/EntryPrimaryView";
import { VideoSummary } from "@/components/entry/VideoSummary";
import { ProjectPanel } from "@/components/entry/ProjectPanel";

/**
 * /entry/[id] — full-detail view of one entry, with the interactive
 * board attached.  Server component fetches the entry + its current
 * attachments; the board client component takes over from there for
 * add / edit / reorder / delete operations (Realtime would be nice
 * but it's a single-user-most-of-the-time surface, so on-demand
 * refresh is enough).
 */
export default async function EntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("entries").select("*").eq("id", id).maybeSingle();
  if (error || !row) notFound();

  const entry = rowToEntry(row);
  const cat = getCategory(entry.categoryId);
  if (!cat) notFound();
  const attachments = await listAttachments(entry.id);

  return (
    <div className="fade-in">
      <section className="max-w-[1080px] mx-auto px-10 pt-12 pb-8 border-b border-white/10">
        <div className="flex items-center gap-3 mb-6 text-[12px] font-mono uppercase tracking-widest text-ivory-mute">
          <Link href="/" className="hover:text-gold">Главная</Link>
          <span>/</span>
          <Link href="/categories" className="hover:text-gold">Категории</Link>
          <span>/</span>
          <Link href={`/category/${cat.id}`} className="hover:text-gold">№ {cat.no} · {cat.en}</Link>
          <span>/</span>
          <span className="text-gold truncate max-w-[300px]">{entry.title}</span>
        </div>

        <div className="flex items-end gap-7">
          <div className="text-emerald-200 flex-shrink-0">
            <Icon name={cat.icon} size={68} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-widest text-gold mb-2">
              № {cat.no} · {cat.en}
              {entry.duration && (
                <span className="ml-3 inline-flex items-center gap-1 text-emerald-200">
                  <Icon name="play" size={11} /> {entry.duration}
                </span>
              )}
              {entry.sizeLabel && !entry.duration && (
                <span className="ml-3 text-emerald-200">· {entry.sizeLabel}</span>
              )}
              {entry.pinned && <span className="ml-3 text-emerald-200">· закреплено</span>}
              <span className="ml-3 text-ivory-mute normal-case tracking-normal">· добавлено {formatDateTime(entry.createdAt)}</span>
            </div>
            <h1 className="font-display text-[56px] font-light leading-[0.95] tracking-tightest mb-3">
              {entry.title}
            </h1>
            {entry.description && (
              <p className="text-[16px] text-ivory-dim leading-relaxed font-light max-w-2xl">
                {entry.description}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-4">
              {entry.tags.map((t) => (
                <span key={t} className="tag-soft">{t}</span>
              ))}
              {entry.url && (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-gold/40 text-gold hover:bg-gold hover:text-emerald-deep transition flex items-center gap-1.5"
                >
                  <Icon name="arrow" size={11} /> Внешняя ссылка
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {entry.url && (
        <EntryPrimaryView
          url={entry.url}
          title={entry.title}
          sizeLabel={entry.sizeLabel}
          duration={entry.duration}
        />
      )}

      {/* Thesis summary for YouTube entries — extractive, lazy-fetched
          via /api/entries/[id]/summarize on first visit and cached in
          entry.metadata.summary so subsequent loads are instant. */}
      {entry.url && /(?:youtube\.com|youtu\.be)/.test(entry.url) && (
        <VideoSummary
          entryId={entry.id}
          videoUrl={entry.url}
          initial={Array.isArray(entry.metadata?.summary)
            ? (entry.metadata.summary as string[])
            : undefined}
          initialSource={typeof entry.metadata?.summarySource === "string"
            ? entry.metadata.summarySource
            : undefined}
        />
      )}

      {/* Portfolio entries get a dedicated workspace panel: ТЗ,
          quick links, custom links, and credentials.  Renders above
          the EntryBoard so the project's structured fields land
          before the freeform attachment grid. */}
      {entry.categoryId === "portfolio" && <ProjectPanel entry={entry} />}

      <EntryBoard entry={entry} initial={attachments} />
    </div>
  );
}
