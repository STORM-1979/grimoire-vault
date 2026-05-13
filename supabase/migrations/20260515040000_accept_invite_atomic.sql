-- Atomic invite consumption.
--
-- The TS version did SELECT used_at → check → INSERT membership → UPDATE
-- used_at as four separate statements, so two concurrent POSTs to
-- /api/vault-invites/<code> would both see used_at=null and both run
-- the membership insert (the second one bouncing off the PK constraint,
-- but the invite still gets marked used twice).
--
-- This RPC does the whole flow under a single transaction with a
-- SELECT ... FOR UPDATE on the invite row so the second caller blocks
-- until the first one finishes, then sees used_at populated and gets
-- the "already used" error.
--
-- Returns one row: vault_id, already_member.  Caller hydrates the
-- vault record after.

create or replace function public.accept_vault_invite(
  p_code text,
  p_user_id uuid
) returns table (
  vault_id uuid,
  already_member boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
  v_vault_id  uuid;
  v_expires   timestamptz;
  v_used_at   timestamptz;
  v_existing  uuid;
begin
  -- Lock the invite row so a second concurrent caller waits here
  -- rather than racing past the used_at check.
  select id, vault_id, expires_at, used_at
    into v_invite_id, v_vault_id, v_expires, v_used_at
    from public.vault_invites
   where code = p_code
   for update;

  if v_invite_id is null then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;
  if v_used_at is not null then
    raise exception 'invite_already_used' using errcode = 'P0001';
  end if;
  if v_expires < now() then
    raise exception 'invite_expired' using errcode = 'P0001';
  end if;

  -- Check existing membership before insert so we can return the
  -- already_member flag without relying on insert-conflict semantics.
  select user_id into v_existing
    from public.vault_members
   where vault_id = v_vault_id and user_id = p_user_id;

  if v_existing is null then
    insert into public.vault_members (vault_id, user_id, role)
    values (v_vault_id, p_user_id, 'editor');
  end if;

  update public.vault_invites
     set used_at = now(), used_by = p_user_id
   where id = v_invite_id;

  return query select v_vault_id, (v_existing is not null);
end;
$$;

grant execute on function public.accept_vault_invite(text, uuid) to authenticated;
