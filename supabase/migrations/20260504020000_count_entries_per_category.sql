-- ============================================================
--  Phase 6 polish: server-side aggregation for the home page.
--  Replaces a `select category_id` + JS-side reduce (transmits one
--  row per entry) with a single aggregated round-trip.
--
--  `security invoker` + `auth.uid()` → RLS still scopes to the caller.
-- ============================================================

create or replace function public.count_entries_per_category()
returns table (category_id text, count bigint)
language sql
security invoker
stable
as $$
  select category_id, count(*)::bigint
  from public.entries
  where user_id = auth.uid()
  group by category_id;
$$;

-- Allow signed-in users to call it; the function still respects RLS via
-- the user_id = auth.uid() filter.
grant execute on function public.count_entries_per_category() to authenticated;

comment on function public.count_entries_per_category() is
  'Aggregated entry counts for the calling user. Used by the home page to
   avoid streaming one row per entry when only counts are needed.';
