-- ============================================================
-- Migration 018: Startowe KPI typu pivot
-- ============================================================
-- Wstawiamy 3 gotowe pivot-tables, żeby user miał punkt startowy:
--   1. Marketing P&L per miesiąc/sklep
--   2. Kampanie Meta (efektywność per kampania)
--   3. Kampanie Google (efektywność per kampania)
-- ============================================================

INSERT INTO kpi_definitions (name, description, category, tier, value_type, query_spec)
VALUES
(
  'Marketing P&L per miesiąc / sklep',
  'Przychód brutto vs spend (Meta + Google + agencja) — profit i marketing % w jednej tabeli.',
  'Marketing', 'core', 'currency',
  $$
  {
    "chart_type": "pivot",
    "x_axis": "date",
    "y_axis": "revenue_gross",
    "granularity": "month",
    "filters_advanced": [],
    "row_dims": ["date", "source_shop"],
    "metrics": [
      { "kind": "raw", "key": "revenue_gross", "format": "pln" },
      { "kind": "raw", "key": "meta_spend", "format": "pln" },
      { "kind": "raw", "key": "google_spend", "format": "pln" },
      { "kind": "raw", "key": "agency_cost", "format": "pln" },
      { "kind": "template", "template": "profit_after_mkt" },
      { "kind": "template", "template": "marketing_pct" },
      { "kind": "template", "template": "roas" }
    ]
  }
  $$::jsonb
),
(
  'Kampanie Meta — efektywność',
  'Per kampania Meta: spend, revenue, ROAS, CPA, CPM. Filter source_platform=meta.',
  'Marketing', 'standard', 'currency',
  $$
  {
    "chart_type": "pivot",
    "x_axis": "campaign",
    "y_axis": "meta_spend",
    "granularity": "month",
    "filters_advanced": [],
    "row_dims": ["campaign"],
    "metrics": [
      { "kind": "raw", "key": "meta_spend", "format": "pln" },
      { "kind": "raw", "key": "meta_revenue", "format": "pln" },
      { "kind": "raw", "key": "meta_impressions", "format": "number" },
      { "kind": "raw", "key": "meta_clicks", "format": "number" },
      { "kind": "raw", "key": "meta_conversions", "format": "number" },
      { "kind": "template", "template": "roas" },
      { "kind": "template", "template": "cpa" },
      { "kind": "template", "template": "cpm" }
    ]
  }
  $$::jsonb
),
(
  'Kampanie Google — efektywność',
  'Per kampania Google Ads: spend, revenue GA4, sesje, ROAS, conv. rate. Dane z source=google/medium=cpc.',
  'Marketing', 'standard', 'currency',
  $$
  {
    "chart_type": "pivot",
    "x_axis": "campaign",
    "y_axis": "google_spend",
    "granularity": "month",
    "filters_advanced": [],
    "row_dims": ["campaign"],
    "metrics": [
      { "kind": "raw", "key": "google_spend", "format": "pln" },
      { "kind": "raw", "key": "ga_revenue", "format": "pln" },
      { "kind": "raw", "key": "sessions", "format": "number" },
      { "kind": "raw", "key": "transactions", "format": "number" },
      { "kind": "template", "template": "roas" },
      { "kind": "template", "template": "conv_rate" }
    ]
  }
  $$::jsonb
)
ON CONFLICT DO NOTHING;
