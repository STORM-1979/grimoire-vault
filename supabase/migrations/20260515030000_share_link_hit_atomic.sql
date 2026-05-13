-- Atomic increment of share_links.hit_count.
--
-- The previous TS code did a SELECT then a follow-up UPDATE based on
-- the read value, but the SELECT didn't even include hit_count in the
-- column list — the field was cast through `as unknown as` and came
-- back undefined, so the counter was permanently reset to 1 on every
-- view.  Even if the column had been read, two concurrent visitors
-- would race and one increment would be lost.
--
-- This RPC takes the link id and a current ISO timestamp, bumps the
-- counter via UPDATE with a single +1 expression (which is atomic at
-- the row level), and returns the new value.  Fire-and-forget on the
-- caller side is still fine — even if the caller never awaits, the
-- row update lands.

create or replace function public.bump_share_hit(
  p_link_id uuid,
  p_now timestamptz
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  update public.share_links
     set hit_count   = coalesce(hit_count, 0) + 1,
         last_hit_at = p_now
   where id = p_link_id
   returning hit_count into v_new;
  return coalesce(v_new, 0);
end;
$$;

grant execute on function public.bump_share_hit(uuid, timestamptz) to anon, authenticated;
