# Plan naprawy pipeline'u CSV → Supabase

Stack docelowy: Next.js + Supabase (zachowujemy obecny — patrz audyt, sekcja "Co potrzebuję").
Zadanie z brancha: `claude/fix-csv-normalization-4fQ0m`.
**Wymaga akceptacji przed implementacją.**

---

## Etap 0 — Inspekcja produkcji (przed migracją)

Wymaga dostępu do Supabase (nie mam w tej sesji).

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('raw_erp_orders','fact_orders','fact_order_items','etl_log')
ORDER BY table_name, ordinal_position;

-- ile wierszy w raw_erp_orders (0 == bezpiecznie zmienić schemat)
SELECT count(*) FROM raw_erp_orders;

-- ile wierszy w fact_orders / fact_order_items (decyduje czy migrate-in-place vs. recreate)
SELECT (SELECT count(*) FROM fact_orders) AS orders,
       (SELECT count(*) FROM fact_order_items) AS items,
       (SELECT count(*) FROM etl_log) AS logs;
```

Wynik tej inspekcji zdecyduje czy migracje 005+ są ALTER czy CREATE.

---

## Etap 1 — Migracja DB (`supabase/migrations/005_csv_pipeline_hardening.sql`)

```sql
-- ============================================================
-- Migracja 005: CSV pipeline hardening
-- - Dodaje audit columns do fact_orders/fact_order_items
-- - Wzmacnia raw_erp_orders i etl_log
-- - Tworzy widoki billable / producer
-- ============================================================

-- 1) raw_erp_orders — dodaj audit kolumny (tabela istnieje od 001 ale jest pusta)
ALTER TABLE raw_erp_orders
  ADD COLUMN IF NOT EXISTS csv_row_number INTEGER,
  ADD COLUMN IF NOT EXISTS etl_run_id UUID,
  ADD COLUMN IF NOT EXISTS source_file TEXT,
  ADD COLUMN IF NOT EXISTS loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_raw_erp_etl_run ON raw_erp_orders(etl_run_id);
CREATE INDEX IF NOT EXISTS idx_raw_erp_loaded ON raw_erp_orders(loaded_at DESC);

-- 2) fact_orders — change tracking
ALTER TABLE fact_orders
  ADD COLUMN IF NOT EXISTS first_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS row_hash        TEXT;

CREATE INDEX IF NOT EXISTS idx_fact_orders_last_seen ON fact_orders(last_seen_at);

-- backfill row_hash dla istniejących wierszy (deterministyczny)
UPDATE fact_orders SET row_hash = md5(
  concat_ws('|',
    coalesce(source_shop,''), coalesce(status,''), coalesce(is_paid::text,''),
    coalesce(total_gross::text,''), coalesce(shipping_cost::text,''),
    coalesce(supplier,''), coalesce(production_batch,''),
    coalesce(notes,''), coalesce(invoice_production,''),
    coalesce(invoice_mattress,''), coalesce(invoice_transport,'')
  )
) WHERE row_hash IS NULL;

ALTER TABLE fact_orders ALTER COLUMN row_hash SET NOT NULL;

-- 3) fact_order_items — UNIQUE + audit
ALTER TABLE fact_order_items
  ADD COLUMN IF NOT EXISTS first_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- usunąć ewentualne duplikaty zanim dodamy UNIQUE
DELETE FROM fact_order_items a
USING fact_order_items b
WHERE a.id < b.id
  AND a.order_id = b.order_id
  AND a.line_number = b.line_number;

ALTER TABLE fact_order_items
  ADD CONSTRAINT IF NOT EXISTS fact_order_items_uniq UNIQUE (order_id, line_number);

-- 4) etl_log — pipeline / version / details / quarantined
ALTER TABLE etl_log
  ADD COLUMN IF NOT EXISTS pipeline TEXT,
  ADD COLUMN IF NOT EXISTS version  TEXT,
  ADD COLUMN IF NOT EXISTS rows_quarantined INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details JSONB;

-- backfill pipeline z source dla starych wpisów (informational)
UPDATE etl_log SET pipeline = source WHERE pipeline IS NULL;

-- 5) Widoki dla dashboardów
CREATE OR REPLACE VIEW v_orders_billable AS
SELECT *
FROM fact_orders
WHERE status IN ('zamówienie', 'zrealizowane');  -- normalized values from parser

CREATE OR REPLACE VIEW v_orders_with_producer AS
SELECT
  o.*,
  CASE
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%comfy%'    THEN 'Comfy'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%profoam%'  THEN 'Profoam'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%mobler%'   THEN 'MOBLER'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%mazur%'    THEN 'Mazur'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%relax%'    THEN 'RELAX'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%tobi one%' THEN 'Tobi One'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%vongai%'   THEN 'VONGAI'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%włodex%'   THEN 'Włodex'
    ELSE o.supplier  -- fallback do hand-classification z parsera
  END AS producer
FROM fact_orders o;
```

> Uwaga: w Postgres `ADD CONSTRAINT IF NOT EXISTS` na UNIQUE wymaga PG14+. Supabase jest na PG15 — OK.
> Jeśli jednak baza już ma duplikaty `fact_order_items`, krok DELETE je czyści (zostawia najnowszy `id`).

## Etap 2 — Upgrade parsera (`src/lib/erp-parser.ts`)

Zmiany:
1. **Strefa czasowa**: dodać helper `localToUtc(naive: string): string` używając `Intl.DateTimeFormat` z `timeZone: 'Europe/Warsaw'`. Aplikować do `order_date`, `expected_date`, `fulfillment_date`.
2. **Shoper bez sufiksu**: zwrócić `{ platform: 'shoper', shop: 'shoper_unknown' }` + dorzucić warning do `stats.warnings: string[]`.
3. **Postal/phone normalization**: helper `stripFloatSuffix(s)` → usuwa `\.0$`. Aplikować do `Kod pocztowy` i `Klient/Telefon`.
4. **`row_hash`**: nowy helper `computeRowHash(order)` → MD5 z deterministycznych pól biznesowych.
5. **Quarantine**: zmienić sygnaturę `parseErpCsv` → zwracać `{orders, items, quarantine, stats}` gdzie `quarantine: Array<{rowIndex, raw, error}>`.
6. **Producer (whitelist 8)**: nowa funkcja `derivedProducer(tags)` używana zamiast/obok `KNOWN_SUPPLIERS`. Pozostałe tagi zostają w `operational_tags`.
7. **Pillow counts**: albo dodać kolumny w schemacie i types, albo usunąć z `OPTION_KEY_MAP` żeby nie kłamać.

## Etap 3 — ETL flow

`src/app/api/etl/upload/route.ts`:
- `start`: zacznij INSERT do `etl_log` z `pipeline='erp_csv_to_supabase'`, `version=process.env.ETL_VERSION ?? 'next-1.0.0'`.
- `batch_orders`: zmienić upsert tak żeby zachowywać `first_loaded_at` (CONFLICT DO UPDATE z ekspresją `last_updated_at = CASE WHEN row_hash distinct THEN now() ELSE last_updated_at`). Nowy SQL (przez Supabase RPC lub raw `pg.query` przez serwerowy klient — Supabase REST upsert nie obsługuje tego bezpośrednio, więc dodajemy procedurę plpgsql `fn_upsert_orders(jsonb)`).
- `batch_items`: użyć `upsert` z `onConflict: 'order_id,line_number'` (po dodaniu UNIQUE) zamiast INSERT.
- `batch_raw`: nowa akcja — append do `raw_erp_orders` z `csv_row_number`, `etl_run_id`, `source_file`.
- `finalize`: oblicz sanity checks (orders bez items, items bez parents, missing_orders), zapisz w `etl_log.details`. Ustaw `status='partial'` jeśli `rows_quarantined / rows_total > 0.01`.

`src/app/api/etl/gdrive-sync/route.ts`:
- Dodać lock: `INSERT INTO etl_log (..., status='running') ON CONFLICT DO NOTHING` z constraintem `EXCLUDE WHERE status='running' AND source='gdrive_csv'` (lub prostszy advisory lock przez `SELECT pg_try_advisory_lock(hashtext('gdrive_sync'))`).
- Nie INSERTować drugiego wiersza w `mode=poll` — używać tylko queued ID.
- Po imporcie: zaznacz `last_seen_at=now()` dla zaimportowanych orderów; potem zapisz w details listę orderów które nie pojawiły się w nowym CSV ale były w poprzednim runie (porównanie po `order_id` z poprzednim `etl_log.details.imported_orders`).

## Etap 4 — Quarantine

Vercel functions nie mają persistent FS — kierujemy quarantine do osobnej tabeli:

```sql
CREATE TABLE IF NOT EXISTS etl_quarantine (
  id BIGSERIAL PRIMARY KEY,
  etl_run_id UUID NOT NULL,
  source_file TEXT,
  csv_row_number INTEGER,
  raw_data JSONB NOT NULL,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quarantine_run ON etl_quarantine(etl_run_id);
```

Parser zbiera quarantine w pamięci, ETL flow batchuje insert do `etl_quarantine` i aktualizuje `etl_log.rows_quarantined`.

## Etap 5 — Cron / lock

`vercel.json`:
- Komentarz w UI mówi "06:00 PL". Vercel Cron nie wspiera TZ. Opcje:
  - (a) Zmień schedule na `0 4 * * *` (UTC) — odpala 06:00 CEST (lato) / 05:00 CET (zima).
  - (b) Zostaw `0 6 * * *` UTC i popraw etykietę UI na "08:00 PL (lato) / 07:00 PL (zima)".
  - (c) Najprościej: schedule `0 4 * * *` + sprawdzenie wewnątrz funkcji `Intl.DateTimeFormat` czy w PL jest faktycznie 06:00 — jeśli nie, exit early. To kosztuje 1 invocation w zimie ale jest deterministyczne.
- Rekomendacja: **(a)** + jasna etykieta "06:00 PL (CEST) / 05:00 PL (CET)".

Lock przez `pg_try_advisory_lock` w `gdrive-sync` przed `listCsvFiles` — jeśli false, zwróć `{skipped: true, reason: 'locked'}`.

## Etap 6 — Display / dashboards

- `/api/dashboard/revenue` supplier ranking: przejść z `fact_orders.supplier` na `v_orders_with_producer.producer`.
- `/api/dashboard/products` filtr: dodać `.from('v_orders_billable')` dla revenue widoków, zostawić `fact_orders` dla wszystkich pełnych przekrojów (wraz z anulami).
- `/api/dashboard/database`: usunąć `fact_agency_costs` z `TABLES` (nie istnieje w migracjach) ALBO dodać migrację która ją tworzy. Ja preferuję **usunąć** dopóki nie ma jasnego use-case.

## Etap 7 — Testy

Jest brak infrastruktury testów. Dodam **vitest** (zgodny z Next 16, szybki):

```
package.json:
  devDependencies: { "vitest": "^2", "@vitest/ui": "^2" }
  scripts: { "test": "vitest run", "test:watch": "vitest" }

src/lib/__tests__/
  erp-parser.parse-options.test.ts      — PL + DE samples z prompta
  erp-parser.detect-source.test.ts      — Shopify/Shoper-1/-2/ZAM/Shoper-bez-sufiksu/numeric
  erp-parser.ffill.test.ts              — fixture 3 zamówienia × N pozycji + tag-only
  erp-parser.normalization.test.ts      — postal/phone/decimal/date->utc
  erp-parser.row-hash.test.ts           — idempotencja: te same dane → ten sam hash
  erp-parser.classify-tags.test.ts      — supplier/sales/marketplace/operational
  fixtures/sample.csv                   — minimalny fixture (z prompta)
```

CI: `npm test` w GH Actions (osobny workflow) — opcjonalnie, ale rekomenduję.

## Etap 8 — Rollout

1. PR z migracją 005 (apply lokalnie / staging Supabase, weryfikuj backfill `row_hash`).
2. PR z parserem + types + testy (zielono lokalnie).
3. PR z ETL flow + quarantine + lock.
4. PR z dashboardami (przełączenie na widoki).
5. Manual smoke test: upload znanego CSV 2x → sprawdź `last_updated_at` niezmienione, `last_seen_at` świeży, `created_at` (a właściwie `first_loaded_at`) niezmieniony, brak duplikatów items.
6. Po zatwierdzeniu — deploy na Vercel. Cron zacznie używać nowej ścieżki przy następnym tickucie.

## Co świadomie nie robię (nie mieści się w "naprawmy normalizację")

- Nie przepisuję na Python/psycopg2 (jak prompt sugeruje) — zostajemy przy Next.js.
- Nie ruszam Meta/GA4/Pinterest ETL — out of scope.
- Nie buduję `fact_agency_costs` — out of scope, nie ma ownera.
- Nie zmieniam UX adminowego (`/dashboard/admin`) poza koniecznymi reactjowymi adaptacjami.

---

## Decyzje do potwierdzenia (proszę o krótkie tak/nie)

1. **Schemat migracji 005** — apply zgodnie z planem powyżej?
2. **Whitelist producentów** — 8 z prompta, reszta do `operational_tags`?
3. **Cron** — opcja (a): `0 4 * * *` UTC + etykieta "06:00 CEST / 05:00 CET"?
4. **Quarantine** — tabela `etl_quarantine` w Supabase (nie JSONL na FS, bo Vercel)?
5. **Pillow counts** — usuwam z parsera (nie ma kolumn) czy dodaję kolumny?
6. **Test runner** — vitest OK?

Po Twoim "tak na wszystko" lub korektach — implementuję iteracyjnie i robię osobne commity per etap.
