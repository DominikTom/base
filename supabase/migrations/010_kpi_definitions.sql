-- ============================================================
-- Migration 010: Rejestr definicji KPI
-- ============================================================
-- Cele:
--   1. kpi_definitions — wspólny, nazwany katalog KPI (kategoria, tier,
--      typ wartości, specyfikacja zapytania). Wielokrotnego użytku jako
--      widgety na "Mój Dashboard".
--   2. query_spec ma kształt configa widgetu custom_explorer:
--      { chart_type, x_axis, y_axis, group_by, granularity, filters_advanced[] }
--      — dzięki temu istniejący widget-renderer renderuje KPI bez zmian.
--   3. RLS — katalog współdzielony: każdy zalogowany czyta, tylko admin
--      tworzy/edytuje/usuwa.
-- ============================================================

CREATE TABLE IF NOT EXISTS kpi_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Ogólne',
  tier TEXT NOT NULL DEFAULT 'standard',     -- 'core' | 'standard' | 'experimental'
  value_type TEXT NOT NULL DEFAULT 'number', -- 'currency' | 'number' | 'percent' | 'ratio'
  query_spec JSONB NOT NULL,                 -- kształt configa custom_explorer
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_definitions_category ON kpi_definitions (category);

DROP TRIGGER IF EXISTS trg_kpi_definitions_updated_at ON kpi_definitions;
CREATE TRIGGER trg_kpi_definitions_updated_at
  BEFORE UPDATE ON kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============ RLS ============

ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;

-- Odczyt: każdy zalogowany użytkownik (katalog współdzielony)
CREATE POLICY "Authenticated read kpi" ON kpi_definitions
  FOR SELECT USING (auth.role() = 'authenticated');

-- Zapis: tylko administratorzy (rola w user_profiles)
CREATE POLICY "Admins write kpi" ON kpi_definitions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'admin'
    )
  );

-- service_role (API) ma pełny dostęp — walidacja uprawnień w warstwie API
CREATE POLICY "Service role full access kpi" ON kpi_definitions
  FOR ALL USING (auth.role() = 'service_role');

-- ============ Startowe definicje KPI ============
-- Kilka gotowych KPI, żeby strona /dashboard/kpi nie była pusta.
INSERT INTO kpi_definitions (name, description, category, tier, value_type, query_spec)
VALUES
  (
    'Przychód brutto', 'Łączny przychód brutto (PLN) w czasie',
    'Sprzedaż', 'core', 'currency',
    '{"chart_type":"area","x_axis":"date","y_axis":"revenue_gross","group_by":"source_shop","granularity":"month","filters_advanced":[]}'::jsonb
  ),
  (
    'Liczba zamówień', 'Liczba zamówień w czasie',
    'Sprzedaż', 'core', 'number',
    '{"chart_type":"bar","x_axis":"date","y_axis":"orders_count","group_by":"","granularity":"month","filters_advanced":[]}'::jsonb
  ),
  (
    'Średnia wartość zamówienia', 'AOV (PLN) w czasie',
    'Sprzedaż', 'standard', 'currency',
    '{"chart_type":"line","x_axis":"date","y_axis":"avg_order_value","group_by":"","granularity":"month","filters_advanced":[]}'::jsonb
  ),
  (
    'Przychód wg kategorii', 'Przychód brutto w podziale na kategorię produktu',
    'Produkty', 'standard', 'currency',
    '{"chart_type":"bar","x_axis":"product_category","y_axis":"revenue_gross","group_by":"","granularity":"month","filters_advanced":[]}'::jsonb
  )
ON CONFLICT DO NOTHING;
