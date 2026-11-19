-- ============================================================
-- 025: serwer MCP dash.mybed (/api/mcp) — tokeny, zakres sklepów, miniatury
-- ============================================================
-- 1. mcp_tokens   — tokeny Bearer per użytkownik (w bazie tylko SHA-256).
-- 2. mcp_audit    — log wywołań narzędzi (bez wyników).
-- 3. user_profiles.allowed_shops — zakres sklepów dla roli viewer.
--    + zamknięcie samodzielnej zmiany roli przez użytkownika (patrz pkt 3).
-- 4. dim_creatives — ścieżki miniatur skopiowanych do Supabase Storage.
-- 5. bucket creative-thumbs — stabilne URL-e miniatur (linki fbcdn wygasają).
--
-- Wszystkie odczyty i zapisy idą przez serwer (service role omija RLS),
-- więc tabele mają RLS bez polityk = brak dostępu z kluczem anon.

-- ── 1. Tokeny MCP ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    token_prefix  TEXT NOT NULL,          -- pierwsze znaki tokenu do rozpoznania w UI
    token_hash    TEXT NOT NULL UNIQUE,   -- SHA-256 (hex) całego tokenu
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens (user_id);

ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mcp_tokens FROM PUBLIC, anon, authenticated;

-- ── 2. Audyt wywołań ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_audit (
    id          BIGSERIAL PRIMARY KEY,
    token_id    UUID REFERENCES mcp_tokens (id) ON DELETE SET NULL,
    user_id     UUID,
    tool        TEXT NOT NULL,
    args        JSONB,
    rows        INTEGER,
    duration_ms INTEGER,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_created ON mcp_audit (created_at DESC);

ALTER TABLE mcp_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mcp_audit FROM PUBLIC, anon, authenticated;

-- ── 3. Zakres sklepów + rola tylko z serwera ────────────────
-- allowed_shops: NULL = wszystkie sklepy (tak jak dziś w dashboardzie).
-- admin zawsze widzi wszystkie sklepy niezależnie od tej kolumny.
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS allowed_shops TEXT[];

COMMENT ON COLUMN user_profiles.allowed_shops IS
  'Sklepy dostępne dla roli viewer (mybed.pl, mybed.de, mojepostel.cz, mittohome.pl, nomosleep.pl). NULL = wszystkie. Ustawia admin.';

-- Polityka "Users can update own profile" (002) pozwalała zmienić KAŻDĄ
-- kolumnę własnego wiersza kluczem anon z przeglądarki — w tym role i
-- allowed_shops. Zostawiamy użytkownikowi tylko kolumny, które aplikacja
-- zapisuje w jego imieniu; rola i zakres sklepów — wyłącznie service role.
REVOKE INSERT, UPDATE ON user_profiles FROM PUBLIC, anon, authenticated;
GRANT INSERT (user_id, email, display_name, dashboard_layout) ON user_profiles TO authenticated;
GRANT UPDATE (user_id, email, display_name, dashboard_layout) ON user_profiles TO authenticated;

-- ── 4. Miniatury w Storage ──────────────────────────────────
ALTER TABLE dim_creatives
    ADD COLUMN IF NOT EXISTS thumb_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS image_storage_path TEXT,
    ADD COLUMN IF NOT EXISTS thumb_stored_at    TIMESTAMPTZ;

-- ── 5. Bucket na miniatury kreacji ──────────────────────────
-- Publiczny do odczytu: to kopie emitowanych reklam (i tak publicznych
-- w Bibliotece reklam Meta). Zapis tylko service role.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('creative-thumbs', 'creative-thumbs', TRUE, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

-- ── Przy okazji: funkcje SECURITY DEFINER z 022 ─────────────
-- 022 odebrało EXECUTE tylko anon/authenticated, a nie PUBLIC — co (jak
-- zauważa sama 022 kilka linii niżej) nic nie zmienia, bo anon dziedziczy
-- po PUBLIC. Bez tego klucz anon może wywołać purge raw_erp_orders.
REVOKE EXECUTE ON FUNCTION fn_rebuild_daily_revenue(date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_rebuild_dim_products()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_rebuild_dim_fabrics()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_purge_raw_erp_orders(integer)   FROM PUBLIC, anon, authenticated;
