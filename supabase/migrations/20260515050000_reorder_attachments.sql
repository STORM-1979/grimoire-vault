-- Atomic attachment reorder.
--
-- Mirrors the kanban reorder migration: one DB round-trip instead of
-- N (one per attachment), and the whole reorder happens in a single
-- transaction so a network drop midway can't leave the board with
-- mixed old/new positions.
--
-- The function trusts RLS for ownership — caller's user session is
-- propagated through SECURITY INVOKER, so a user can only update
-- positions on their own entries.

create or replace function public.reorder_attachments(
  p_entry_id uuid,
  p_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- with-ordinality unfolds the array into (id, ordinal) pairs we
  -- can join back against entry_attachments to set position in one
  -- statement.
  update public.entry_attachments ea
     set position = ord.idx - 1
    from unnest(p_ids) with ordinality as ord(id, idx)
   where ea.id = ord.id
     and ea.entry_id = p_entry_id;
end;
$$;

grant execute on function public.reorder_attachments(uuid, uuid[]) to authenticated;
