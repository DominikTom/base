-- ============================================================
-- Migration 023: restore ai_readonly access after the RLS lockdown
-- ============================================================
--
-- Migration 022 enabled RLS on the analytics tables. That locked out the
-- `ai_readonly` role from migration 008, which backs /api/assistant/chat:
-- ai_readonly is a plain NOLOGIN role, not service_role, so it does NOT bypass
-- RLS. With RLS on and no policy it saw zero rows on every table it had been
-- granted — the AI assistant answered "no data" for everything.
--
-- (Two of those tables, fact_daily_ad_performance and dim_creatives, already
-- had RLS enabled with no policy before 022, so the assistant was already
-- blind to ad-level data before this lockdown.)
--
-- Restore exactly what migration 008 granted: SELECT, on the same 11 tables.
-- The tables 008 deliberately withheld stay without a policy and so remain
-- unreadable for this role — raw_* (customer PII), user_profiles,
-- ai_conversations, ai_messages, kpi_definitions, etl_quarantine,
-- reconciliation_log.
--
-- Policies are scoped TO ai_readonly, so anon and authenticated stay denied.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fact_orders',
    'fact_order_items',
    'fact_daily_revenue',
    'fact_daily_adspend',
    'fact_daily_traffic',
    'fact_daily_ad_performance',
    'dim_exchange_rates',
    'dim_products',
    'dim_fabrics',
    'dim_creatives',
    'etl_log'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS ai_readonly_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY ai_readonly_select ON public.%I FOR SELECT TO ai_readonly USING (true)', t
    );
  END LOOP;
END $$;
