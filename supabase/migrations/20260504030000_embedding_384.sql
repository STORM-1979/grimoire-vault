-- ============================================================
--  Phase 6 — semantic search via on-device embeddings.
--
--  Schema originally provisioned `embedding vector(1536)` for Voyage AI
--  (1536-dim).  We're switching to a fully-autonomous, free, in-browser
--  pipeline using `multilingual-e5-small` (384-dim, multilingual incl.
--  Russian) via `@huggingface/transformers`.  No keys, no external API.
--
--  Postgres can't ALTER a vector column dimension in place, so we drop
--  the existing column + ivfflat index and recreate at 384-dim.  Existing
--  rows lose their (always-null in this app) embeddings — backfilled
--  client-side via the "Reindex" button in Settings.
-- ============================================================

drop index if exists public.entries_embedding_idx;
-- entries_full view references embedding — drop it; we recreate below.
drop view if exists public.entries_full;
alter table public.entries drop column if exists embedding;
alter table public.entries add column embedding vector(384);

-- Recreate entries_full with the new 384-dim column. Same definition as
-- the original — joining categories for cat_no / cat_en / cat_ru / cat_icon.
create or replace view public.entries_full as
  select e.id, e.user_id, e.category_id, e.title, e.description, e.body,
         e.url, e.thumb_url, e.cover_url, e.duration, e.size_bytes, e.size_label,
         e.file_count, e.source_path, e.extracted_text, e.ai_summary,
         e.content_hash, e.metadata, e.tags, e.pinned, e.imported_via,
         e.manifest_id, e.embedding, e.search_tsv, e.created_at, e.updated_at,
         c.no  as cat_no,
         c.en  as cat_en,
         c.ru  as cat_ru,
         c.icon as cat_icon
  from public.entries e
  join public.categories c on c.id = e.category_id;

-- HNSW gives much better recall/latency than ivfflat for small-to-medium
-- corpora and doesn't need a build-time `lists` parameter.  Cosine ops
-- because e5 embeddings are L2-normalised — cosine == dot product.
create index if not exists entries_embedding_idx
  on public.entries using hnsw (embedding vector_cosine_ops);

comment on column public.entries.embedding is
  '384-dim multilingual-e5-small embedding, computed client-side. Null until
   backfilled. Used by /api/search?mode=semantic via cosine similarity.';

-- ------------------------------------------------------------
--  Server-side semantic search RPC.
--
--  Takes a 384-float query embedding (computed in the browser from the
--  user''s search query) and returns the top-N entries by cosine distance,
--  filtered by RLS (auth.uid() = user_id) and optionally by category.
--
--  Returns `similarity` (1 - distance, range 0..1) so the UI can show a
--  relevance badge and discard low-confidence matches.
-- ------------------------------------------------------------
create or replace function public.search_entries_semantic(
  query_embedding vector(384),
  match_count     int     default 30,
  match_threshold float   default 0.20,
  filter_category text    default null
)
returns table (
  similarity      float,
  id              uuid,
  user_id         uuid,
  category_id     text,
  title           text,
  description     text,
  body            text,
  url             text,
  thumb_url       text,
  cover_url       text,
  duration        text,
  size_bytes      bigint,
  size_label      text,
  file_count      int,
  source_path     text,
  extracted_text  text,
  ai_summary      text,
  content_hash    text,
  metadata        jsonb,
  tags            text[],
  pinned          boolean,
  imported_via    text,
  manifest_id     uuid,
  created_at      timestamptz,
  updated_at      timestamptz
)
language sql
security invoker
stable
as $$
  select 1 - (e.embedding <=> query_embedding) as similarity,
         e.id, e.user_id, e.category_id, e.title, e.description, e.body,
         e.url, e.thumb_url, e.cover_url, e.duration, e.size_bytes, e.size_label,
         e.file_count, e.source_path, e.extracted_text, e.ai_summary,
         e.content_hash, e.metadata, e.tags, e.pinned, e.imported_via,
         e.manifest_id, e.created_at, e.updated_at
  from public.entries e
  where e.user_id = auth.uid()
    and e.embedding is not null
    and (filter_category is null or e.category_id = filter_category)
    and 1 - (e.embedding <=> query_embedding) >= match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.search_entries_semantic(vector, int, float, text) to authenticated;

comment on function public.search_entries_semantic(vector, int, float, text) is
  'Cosine-similarity search over entries.embedding. Query vector is computed
   client-side via @huggingface/transformers (multilingual-e5-small, 384-dim).
   RLS-scoped via auth.uid().';
