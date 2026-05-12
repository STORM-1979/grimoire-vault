-- Make the password ciphertext nullable.
--
-- Why: a "credential" isn't always a password.  Accounts wired
-- through SSO (Google / GitHub / Apple), email-magic-link only,
-- or hardware-key-only logins have no standalone password to
-- store.  Forcing the user to type something like "via Google"
-- into the password field defeats the type system (strength
-- evaluation becomes nonsense) and the encryption budget (we
-- burn a fresh AES-GCM IV on a 12-character placeholder).
--
-- Behaviour after this migration:
--   * Existing rows stay non-null — nothing changes for them.
--   * New rows may set password_encrypted IS NULL when the user
--     leaves the field blank in the modal.
--   * iv_password is already nullable from the initial schema, so
--     no companion change is needed there.
--   * The decrypt path in useCredentials returns "" when the
--     ciphertext is null, so the UI sees an empty password and
--     hides the masked-dots + copy chip accordingly.

ALTER TABLE credentials
  ALTER COLUMN password_encrypted DROP NOT NULL;

COMMENT ON COLUMN credentials.password_encrypted IS
  'AES-GCM ciphertext of the password.  NULL means the account has no standalone password — e.g. SSO via Google/GitHub, email-magic-link only, or hardware-key-only.';
