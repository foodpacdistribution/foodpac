-- Server-side limits for the app's database user, so stuck work clears itself instead of
-- hanging every page (2026-11-09: admin pages hit the app's 10 s query cut-off every ~12 s).
--  * A transaction left open and idle (its server froze or died mid-way) is ended after 60 s,
--    releasing the row locks it held.
--  * A statement waiting on a lock gives up after 8 s with "canceling statement due to lock
--    timeout", which names the query, instead of hanging until the app drops every connection.
-- Applies to new database sessions. Skipped (with a notice) where the user may not change it.
DO $$
BEGIN
  EXECUTE 'ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = ''60s''';
  EXECUTE 'ALTER ROLE CURRENT_USER SET lock_timeout = ''8s''';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not set session timeouts for %: %', current_user, SQLERRM;
END $$;
