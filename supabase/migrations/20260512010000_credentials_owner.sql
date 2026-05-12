-- Add an "owner" tag column to credentials.
--
-- Lets a shared vault split between multiple people whose
-- accounts live in the same Grimoire instance: Вова's GitHub
-- vs Серый's GitHub stay distinct without forcing the user to
-- bake the owner into the service name ("GitHub (Вова)").
--
-- Stored plaintext on purpose — owner is metadata used for
-- filtering, not the secret itself.  Same precedent as the
-- `service` column.
--
-- Index on (user_id, owner) makes the per-owner filter on the
-- credentials page cheap as the vault grows.

ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS owner TEXT;

CREATE INDEX IF NOT EXISTS credentials_owner_idx
  ON credentials(user_id, owner);

COMMENT ON COLUMN credentials.owner IS
  'Optional account-owner tag — splits the vault between people who share it (e.g. Вова / Серый). Stored plaintext: this is metadata, not secret.';
