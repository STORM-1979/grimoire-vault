-- ============================================================
--  review_schedule — SM-2-style spaced-repetition state per entry.
--
--  An entry is in the queue iff a row exists here.  Reviewing an
--  entry updates ease_factor + interval_days according to the
--  algorithm and bumps due_date forward.  Skipping ("Не помню")
--  resets interval to 1 day and lowers ease.
-- ============================================================

create table if not exists public.review_schedule (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  entry_id      uuid not null references public.entries(id) on delete cascade,
  ease_factor   numeric(4, 2) not null default 2.50, -- SM-2 EF, starts at 2.5
  interval_days integer not null default 1,
  -- Date the entry should next be shown.  Anything ≤ today is "due".
  due_date      date not null default current_date,
  -- Tally of consecutive successful reviews (resets on lapse).
  streak        integer not null default 0,
  total_reviews integer not null default 0,
  last_review_at timestamptz,
  created_at    timestamptz not null default now(),

  unique (user_id, entry_id)
);

create index if not exists review_schedule_due
  on public.review_schedule (user_id, due_date);

alter table public.review_schedule enable row level security;

drop policy if exists review_schedule_select on public.review_schedule;
create policy review_schedule_select on public.review_schedule
  for select using (user_id = auth.uid());

drop policy if exists review_schedule_insert on public.review_schedule;
create policy review_schedule_insert on public.review_schedule
  for insert with check (user_id = auth.uid());

drop policy if exists review_schedule_update on public.review_schedule;
create policy review_schedule_update on public.review_schedule
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists review_schedule_delete on public.review_schedule;
create policy review_schedule_delete on public.review_schedule
  for delete using (user_id = auth.uid());

insert into public.schema_migrations (name, applied_at, applied_by)
values ('20260507020000_review_schedule', now(), 'manual')
on conflict (name) do nothing;
