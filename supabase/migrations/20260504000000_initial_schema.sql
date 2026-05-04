-- ============================================================
--  Grimoire Vault — initial schema
--  Created 2026-05-04, version 0.1.0
--  Apply via: supabase db push (or paste into Supabase SQL editor)
-- ============================================================

-- 1. Extensions ------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pg_trgm";
create extension if not exists "vector";  -- pgvector for semantic search
-- Optional: pg_cron for scheduled digests, pgsodium for column-level encryption

-- 2. Categories registry --------------------------------------
create table if not exists public.categories (
  id          text primary key,
  no          text not null,
  en          text not null,
  ru          text not null,
  icon        text not null,
  ordering    int  not null,
  secured     boolean default false,
  created_at  timestamptz default now()
);

insert into public.categories (id, no, en, ru, icon, ordering, secured) values
  ('documents',  '01', 'Documents',     'Документы',         'documents', 1, false),
  ('web',        '02', 'Web Resources', 'Ресурсы',           'web',       2, false),
  ('youtube',    '03', 'YouTube',       'Видео',             'youtube',   3, false),
  ('local',      '04', 'Local Data',    'Локальные данные',  'local',     4, false),
  ('designs',    '05', 'Designs',       'Дизайны',           'designs',   5, false),
  ('images',     '06', 'Images',        'Картинки',          'images',    6, false),
  ('skills',     '07', 'Skills',        'Скиллы',            'skills',    7, false),
  ('prompts',    '08', 'Prompts',       'Промпты',           'prompts',   8, false),
  ('kanban',     '09', 'Kanban',        'Канбан',            'kanban',    9, false),
  ('ideas',      '10', 'Ideas',         'Идеи',              'ideas',    10, false),
  ('portfolio',  '11', 'Portfolio',     'Портфолио',         'portfolio',11, false),
  ('misc',       '12', 'Misc',          'Разное',            'misc',     12, false),
  ('credentials','13', 'Credentials',   'Пароли и аккаунты', 'lock',     13, true)
on conflict (id) do nothing;

-- 3. Generic entries -----------------------------------------
-- Stores everything from documents to ideas to youtube videos.
-- Credentials live in a separate table to enforce encryption at rest.
create table if not exists public.entries (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users on delete cascade,
  category_id     text not null references public.categories,
  title           text not null,
  description     text,
  body            text,                       -- system-prompt body / long notes
  url             text,
  thumb_url       text,                       -- 16:9 WebP for videos
  cover_url       text,                       -- 4:3 WebP for media
  duration        text,                       -- 'mm:ss' or 'h:mm:ss'
  size_bytes      bigint,
  size_label      text,                       -- '2.4 MB' display
  file_count      int,
  source_path     text,                       -- R2 key for original
  extracted_text  text,                       -- full-text content
  ai_summary      text,
  content_hash    text,                       -- sha256 for dedup
  metadata        jsonb default '{}'::jsonb,  -- {model, videoId, …}
  tags            text[] default array[]::text[],
  pinned          boolean default false,
  imported_via    text default 'web',         -- web | bot | cli
  manifest_id     uuid,
  embedding       vector(1536),
  search_tsv      tsvector,                 -- maintained by trigger below
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Maintain search_tsv via trigger (works around Postgres immutability check
-- on generated columns that reference to_tsvector with regconfig).
create or replace function public.entries_update_search_tsv()
returns trigger language plpgsql as $$
begin
  new.search_tsv :=
       setweight(to_tsvector('russian'::regconfig, coalesce(new.title,'')), 'A')
    || setweight(to_tsvector('russian'::regconfig, coalesce(new.description,'')), 'B')
    || setweight(to_tsvector('russian'::regconfig, coalesce(new.extracted_text,'')), 'C')
    || setweight(to_tsvector('simple'::regconfig,  coalesce(array_to_string(new.tags, ' '),'')), 'B');
  return new;
end;
$$;

drop trigger if exists trg_entries_search_tsv on public.entries;
create trigger trg_entries_search_tsv
  before insert or update of title, description, extracted_text, tags
  on public.entries
  for each row execute function public.entries_update_search_tsv();

-- Per-user dedup at category level (allow same hash across categories)
create unique index if not exists entries_dedup_idx
  on public.entries(user_id, category_id, content_hash)
  where content_hash is not null;

create index if not exists entries_user_cat_idx
  on public.entries(user_id, category_id, pinned desc, created_at desc);

create index if not exists entries_search_idx
  on public.entries using gin(search_tsv);

create index if not exists entries_tags_idx
  on public.entries using gin(tags);

create index if not exists entries_embedding_idx
  on public.entries using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 4. Credentials (column-level encrypted on client) ----------
create table if not exists public.credentials (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references auth.users on delete cascade,
  service             text not null,
  url                 text,
  username_encrypted  text not null,    -- AES-GCM ciphertext, base64
  password_encrypted  text not null,
  notes_encrypted     text,
  iv                  text not null,    -- IV for AES-GCM, base64
  two_factor          boolean default false,
  strength            text check (strength in ('weak','medium','strong')),
  tags                text[] default array[]::text[],
  pinned              boolean default false,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists credentials_user_idx
  on public.credentials(user_id, pinned desc, updated_at desc);

-- 5. Kanban board --------------------------------------------
create table if not exists public.kanban_cards (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users on delete cascade,
  column_name       text not null check (column_name in ('backlog','doing','done')),
  position          int  not null,
  title             text not null,
  description       text,
  related_category  text references public.categories,
  due_date          date,
  priority          text check (priority in ('low','medium','high')) default 'medium',
  progress          int check (progress >= 0 and progress <= 100),
  tags              text[] default array[]::text[],
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists kanban_user_col_pos_idx
  on public.kanban_cards(user_id, column_name, position);

-- 6. Imports log ---------------------------------------------
create table if not exists public.imports (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users on delete cascade,
  source_type   text not null,             -- youtube|pdf|html|manual|telegram
  source_url    text,
  manifest      jsonb,
  status        text not null default 'pending',  -- pending|success|partial|failed
  errors        jsonb,
  entry_id      uuid references public.entries on delete set null,
  created_at    timestamptz default now()
);

create index if not exists imports_user_idx
  on public.imports(user_id, created_at desc);

-- 7. Telegram bot sessions -----------------------------------
create table if not exists public.telegram_sessions (
  user_id            uuid primary key references auth.users on delete cascade,
  telegram_chat_id   bigint not null unique,
  link_code          text,                  -- one-time code for /link
  link_code_expires  timestamptz,
  state              jsonb default '{}'::jsonb,
  preferences        jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- 8. updated_at triggers --------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_entries_updated on public.entries;
create trigger trg_entries_updated
  before update on public.entries
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_credentials_updated on public.credentials;
create trigger trg_credentials_updated
  before update on public.credentials
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_kanban_updated on public.kanban_cards;
create trigger trg_kanban_updated
  before update on public.kanban_cards
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_telegram_updated on public.telegram_sessions;
create trigger trg_telegram_updated
  before update on public.telegram_sessions
  for each row execute function public.touch_updated_at();

-- 9. Row-Level Security --------------------------------------
alter table public.entries           enable row level security;
alter table public.credentials       enable row level security;
alter table public.kanban_cards      enable row level security;
alter table public.imports           enable row level security;
alter table public.telegram_sessions enable row level security;
alter table public.categories        enable row level security;

-- Categories are read-only public reference data
create policy "categories are readable by anyone"
  on public.categories for select
  using (true);

-- entries: users access only their own
create policy "entries read own"   on public.entries
  for select using (auth.uid() = user_id);
create policy "entries insert own" on public.entries
  for insert with check (auth.uid() = user_id);
create policy "entries update own" on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "entries delete own" on public.entries
  for delete using (auth.uid() = user_id);

create policy "credentials read own"   on public.credentials
  for select using (auth.uid() = user_id);
create policy "credentials insert own" on public.credentials
  for insert with check (auth.uid() = user_id);
create policy "credentials update own" on public.credentials
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "credentials delete own" on public.credentials
  for delete using (auth.uid() = user_id);

create policy "kanban read own"   on public.kanban_cards
  for select using (auth.uid() = user_id);
create policy "kanban insert own" on public.kanban_cards
  for insert with check (auth.uid() = user_id);
create policy "kanban update own" on public.kanban_cards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "kanban delete own" on public.kanban_cards
  for delete using (auth.uid() = user_id);

create policy "imports read own"   on public.imports
  for select using (auth.uid() = user_id);
create policy "imports insert own" on public.imports
  for insert with check (auth.uid() = user_id);

create policy "telegram read own"   on public.telegram_sessions
  for select using (auth.uid() = user_id);
create policy "telegram upsert own" on public.telegram_sessions
  for insert with check (auth.uid() = user_id);
create policy "telegram update own" on public.telegram_sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 10. Helper view: entries_with_category (joined for UI) ------
create or replace view public.entries_full as
  select e.*, c.no as cat_no, c.en as cat_en, c.ru as cat_ru, c.icon as cat_icon
  from public.entries e
  inner join public.categories c on c.id = e.category_id;

grant select on public.entries_full to authenticated;

-- 11. Realtime publication -----------------------------------
-- Supabase Realtime relies on the `supabase_realtime` publication.
-- We add our user-tables; categories is reference data, no need.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.entries;
alter publication supabase_realtime add table public.credentials;
alter publication supabase_realtime add table public.kanban_cards;

-- 12. Storage buckets (run once via Supabase dashboard or CLI) -
-- Buckets are easier to create via dashboard, but here is the
-- definition for reference. Files actually go to Cloudflare R2;
-- the supabase storage bucket below is fallback only.
--
--   insert into storage.buckets (id, name, public)
--   values ('vault-fallback', 'vault-fallback', false)
--   on conflict (id) do nothing;
--
--   create policy "users access own files"
--     on storage.objects for all
--     using (auth.uid()::text = (storage.foldername(name))[1])
--     with check (auth.uid()::text = (storage.foldername(name))[1]);

-- 13. Done ----------------------------------------------------
comment on schema public is 'Grimoire Vault — personal knowledge base, schema v0.1.0';
