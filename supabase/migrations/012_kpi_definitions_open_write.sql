-- ============================================================
-- Migration 012: Otwarcie zapisu KPI dla wszystkich zalogowanych
-- ============================================================
-- Zakładka KPI staje się jedynym miejscem tworzenia widgetów, więc
-- każdy zalogowany użytkownik musi móc dodać własne KPI (wcześniej
-- tylko administrator). Odczyt pozostaje wspólny (katalog współdzielony);
-- edycja/usuwanie tylko dla autora KPI lub administratora.
-- ============================================================

DROP POLICY IF EXISTS "Admins write kpi" ON kpi_definitions;

CREATE POLICY "Users insert kpi" ON kpi_definitions
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users update own kpi" ON kpi_definitions
  FOR UPDATE USING (
    auth.uid() = created_by
    OR EXISTS (SELECT 1 FROM user_profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY "Users delete own kpi" ON kpi_definitions
  FOR DELETE USING (
    auth.uid() = created_by
    OR EXISTS (SELECT 1 FROM user_profiles p WHERE p.user_id = auth.uid() AND p.role = 'admin')
  );
