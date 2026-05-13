-- Push subscription endpoint uniqueness should be scoped to the
-- user, not global.  Previously a global UNIQUE (endpoint) meant
-- two users who happened to share an endpoint string (device
-- handover, browser-profile re-use, edge cases with the same
-- Web-Push endpoint URL) would silently overwrite each other's
-- subscription row via upsert.  Negligible practical risk but a
-- real cross-user state collision waiting to happen.
--
-- New constraint: UNIQUE (user_id, endpoint).  Upsert in the
-- /api/push/subscribe handler updated to match.

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_endpoint_key
  UNIQUE (user_id, endpoint);
