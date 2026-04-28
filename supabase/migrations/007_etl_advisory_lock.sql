-- ============================================================
-- Migration 007: Advisory lock helpers for ETL concurrency control
-- pg_advisory_lock works at session scope; the supabase-js client opens
-- a fresh session per request, so locks naturally release on connection
-- close even if the function call is interrupted.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_try_advisory_lock(lock_key text)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT pg_try_advisory_lock(hashtext(lock_key));
$$;

CREATE OR REPLACE FUNCTION fn_release_advisory_lock(lock_key text)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT pg_advisory_unlock(hashtext(lock_key));
$$;
