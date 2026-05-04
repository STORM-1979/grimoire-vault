-- ============================================================
--  Phase 3 — Credentials schema refinement
--  Each field gets its own IV (AES-GCM best practice).
--  Existing records (none in production yet) are preserved by
--  reusing the previous `iv` column for username, then dropping.
-- ============================================================

alter table public.credentials
  add column if not exists iv_username text,
  add column if not exists iv_password text,
  add column if not exists iv_notes    text;

-- If there were rows from earlier tests with a single iv, propagate
-- it (best-effort) so nothing breaks.
update public.credentials
  set iv_username = coalesce(iv_username, iv),
      iv_password = coalesce(iv_password, iv)
where iv is not null;

alter table public.credentials drop column if exists iv;

-- iv_username and iv_password become required at write-time;
-- enforced via NOT NULL once schema is stable. For now keep nullable
-- to allow staged rollout.

comment on column public.credentials.iv_username is 'AES-GCM IV (12 bytes, base64) for username_encrypted';
comment on column public.credentials.iv_password is 'AES-GCM IV (12 bytes, base64) for password_encrypted';
comment on column public.credentials.iv_notes    is 'AES-GCM IV (12 bytes, base64) for notes_encrypted, nullable when no notes';
