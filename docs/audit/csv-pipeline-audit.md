# Audyt pipeline'u CSV → Supabase (stan na 2026-04-28)

Branch: `claude/fix-csv-normalization-4fQ0m`
Zakres: import CSV z IdeaERP do tabel `fact_orders` / `fact_order_items` / `fact_daily_revenue` oraz wyświetlanie w dashboardach.

> Audyt został wykonany na podstawie migracji w `supabase/migrations/` oraz kodu TypeScript. **Nie nawiązano połączenia do produkcyjnej Supabase** (brak `SUPABASE_DB_URL` w tej sesji) — przed implementacją wymagane jest potwierdzenie schematu z bazą produkcyjną (zapytanie z pkt 6 dostarczonego prompta).

---

## TL;DR — co działa, co nie działa

| Obszar | Stan | Komentarz |
|---|---|---|
| Architektura (Next.js+browser parsing+Supabase) | OK | Nie odzwierciedla "Python+psycopg2" z prompta — to świadomy wybór, nie błąd. Zachowujemy. |
| Parser PL/DE opcji | Częściowo OK | Brakuje kilku kluczy DE (`Stoff`-like detection przez heurystykę), brak unit testów. |
| Grupowanie wierszy (forward-fill) | OK | `parseErpCsv` poprawnie obsługuje exploded rows i tag-only rows. |
| Mapowanie sklepów | Bug | Shoper bez sufiksu `-1`/`-2` jest cicho klasyfikowany przez język opcji zamiast `shoper_unknown`. |
| Idempotencja | **Bug** | Brak `last_seen_at`/`row_hash`. Re-import zawsze DELETE+INSERT — `created_at` resetuje się, `updated_at` nigdy nie zmienia (DEFAULT NOW() działa tylko na INSERT). |
| Detekcja "zniknionych" zamówień | **Brak** | Nie jest realizowana. Anulacje w ERP nie są wykrywane. |
| `raw_erp_orders` | **Martwy kod** | Tabela zdefiniowana w migracji 001, ale **żaden kod nie pisze do niej**. Brak audit trail surowych danych. |
| Quarantine fail-soft | **Brak** | Wiersze z błędami są cicho pomijane (`continue`), nie ma JSONL ani licznika `rows_quarantined`. |
| Strefa czasowa | **Bug** | `order_date` zapisywany surowy z CSV do `TIMESTAMPTZ` — naive datetime z PL trafia do bazy bez konwersji do UTC. Możliwe odchylenie 1-2h. |
| Cron 06:00 PL | **Bug etykiety** | `vercel.json` `0 6 * * *` to **06:00 UTC** — w lecie odpala 08:00 PL, w zimie 07:00 PL. UI mówi "codziennie o 6:00" — rozjazd. |
| Lock / concurrency | **Brak** | `mode=daily` i `mode=poll` mogą się nakładać. Brak guardu. |
| Klasyfikacja tagów (supplier) | Niespójne | Hand-maintained lista `KNOWN_SUPPLIERS` zawiera 18 nazw, ale prompt wymienia tylko 8 jako oficjalny whitelist. Część dostawców z kodu (Hekiert, AG, Bedtime, ...) nie jest na whitelist'cie usera. |
| Status normalization | Bug | "Zamówienie sprzedaży" → "zamówienie", "Zrealizowane" → "zrealizowane" — OK, ale lowercase + truncate gubią informację. Dashboards używają `'anulowane'` literal — fragile string contract. |
| ETL log audit | Częściowe | `etl_log` ma podstawowe pola ale brak `details JSONB`, `rows_quarantined`, `version`, `pipeline`. |
| Aggregation `fact_daily_revenue` | OK | Liczone w przeglądarce + finalize w API. Dla GDrive cron rebuild po imporcie. |
| Display "Database" tab | Cosmetic | Typowanie kolumn z wartości próbki — `null` → `"unknown"`. `fact_agency_costs` w whitelist ale brak migracji. |
| Display dashboards (overview/products/revenue) | OK | Sensownie zbudowane, używają `fact_daily_revenue` + `fact_orders` z `inner join` przez Supabase relacje. |

---

## TOR 1 — Audyt implementacji (jak to działa DZISIAJ)

### 1.1 Architektura

- **Stack**: Next.js 16 (App Router) + Supabase (`@supabase/supabase-js`) + Vercel Cron + Google Drive API.
- **Parsing**: po stronie przeglądarki (PapaParse) lub po stronie serwera w `/api/etl/gdrive-sync`. Obie ścieżki używają tego samego `parseErpCsv` z `src/lib/erp-parser.ts`.
- **Trzy ścieżki importu**:
  1. **Manual upload** (drag-drop w `/dashboard/admin`): `parse w przeglądarce` → POST batches do `/api/etl/upload`.
  2. **Vercel Cron daily**: `0 6 * * *` UTC → `/api/etl/gdrive-sync?mode=daily` → list+download z GDrive → parse → upsert.
  3. **Vercel Cron poll**: `*/10 * * * *` → `/api/etl/gdrive-sync?mode=poll` → odpala tylko gdy `etl_log.source='gdrive_csv_manual' AND status='queued'` (kolejka z `gdrive-request-sync`).

### 1.2 Schema (migracje)

`supabase/migrations/001_initial_schema.sql` definiuje:
- `raw_erp_orders` — **nieużywana**. Brak `csv_row_number`, `etl_run_id`, `loaded_at`. Indeksy obecne.
- `fact_orders` (PK = `order_id`) — pełen zestaw kolumn biznesowych.
  - **Brak**: `last_seen_at`, `last_updated_at`, `row_hash` (wymagane przez prompt).
  - `created_at` i `updated_at` mają `DEFAULT NOW()` ale brak triggera `BEFORE UPDATE` → `updated_at` nie aktualizuje się przy upsertach.
- `fact_order_items` (PK = BIGSERIAL `id`, FK → `fact_orders` ON DELETE CASCADE).
  - **Brak `UNIQUE(order_id, line_number)`** — możliwe duplikaty przy częściowych rerunach.
- `etl_log` — proste pola, brak `details JSONB`, `rows_quarantined`, `pipeline`, `version`.
- `fact_daily_revenue` — agregat dzienny per sklep, OK.

### 1.3 Parser `src/lib/erp-parser.ts`

**Co robi dobrze:**
- Forward-fill `Numer` przez iterację: nagłówek + sub-rows z produktami + tag-only rows.
- Kategoryzacja produktów (regexy PL+DE) — 18 reguł, fallback `'inne'`.
- Source detection: `Shopify*` → mittohome.pl, `Shoper*-1` → mybed.pl, `Shoper*-2` → mybed.de, `ZAM/*` → showroom, `Amazon*`, `Allegro*`, `Kaufland*` — OK.
- Parser opcji PL+DE — split po `;`, `key:value`, mapowanie do canonical fields. Obsłużone: `bed_size`, `mattress_type`, `fabric`, `headboard_height`, `storage_type`, `headboard_type`, `bed_side`, `pillows_choice`, `duvet_choice`, `legs_type`, `built_in_mattress_type`, `topper_type`, `mattress_hardness`, `wood_color` itd.
- `parseDecimal` poprawnie obsługuje `1234,56` (PL) i `1,234.56` (mieszane).
- `hashEmail` używa Web Crypto API SHA-256.
- Klasyfikacja tagów: supplier (whitelist 18), production_batch (regex `^[Tt][Bb]?\d+$`), sales_person, marketplace_tag, operational_tags.
- Konwersja walut: dla `mybed.de`/`amazon.de`/`kaufland.de` pobiera kurs NBP per data zamówienia.

**Bug-i / luki:**
1. **Strefa czasowa**: linia `const orderDate = orderDateStr || new Date().toISOString();` — string z CSV (np. `"2026-04-28 14:30:00"`) jest naïve i wpada wprost do `TIMESTAMPTZ`. Postgres traktuje go w default timezone serwera (zwykle UTC) — zamówienie z 14:30 PL zapisuje się jako 14:30 UTC = 16:30 PL.
2. **Status normalization** (linia ~354): lowercase + substring match. `"Zamówienie sprzedaży"` → `"zamówienie"`. Dashboards porównują przez literal `'anulowane'`.
3. **Shoper bez sufiksu**: `if (num.startsWith('Shoper'))` → fallback na detekcję języka opcji. Nie loguje warning, nie ustawia `'shoper_unknown'`. Prompt explicite tego wymaga.
4. **Bug `False`**: parser ignoruje tag `"False"` (komentarz w kodzie: "Bug w ERP — ignore"). Ale `is_paid` używa `(h['Zapłacone'] || '').trim().toLowerCase() === 'true'` — czyli `null`, `"None"`, `"False"` wszystkie dają `false`. To OK ale niezweryfikowane testami.
5. **`Klient/Telefon` / `Kod pocztowy` jako float**: prompt wspomina `"56068.0"` z DE i `"1776730468.0"` jako tel. PapaParse z `header:true` zwraca stringi, więc trim wystarczy — ALE jeśli ktoś przepuści to przez Excela i zapisze jako number, dostaniemy `.0`. Brak normalizacji `replace(/\.0$/, '')`. Brak testu regresji.
6. **Pillow count fields**: w map są `pillows_40x40`, `pillows_50x60` itd. ale w `FactOrderItem` w `types/database.ts` te pola **nie istnieją**. Wartości są parsowane do `parsed.pillows_40x40` i… wyrzucane (nie ma kolumny w `fact_order_items`). Schema migracji 001 też ich nie ma.

### 1.4 ETL flow

**`/api/etl/upload`** (manual upload):
- `start` → INSERT etl_log + DELETE z `fact_daily_revenue` w zakresie dat.
- `batch_orders` → DELETE items dla tych order_ids + UPSERT orders ON CONFLICT(order_id).
- `batch_items` → INSERT items (NIE upsert, więc retry powoduje duplikaty bo brak UNIQUE constraint).
- `batch_daily_revenue` → UPSERT.
- `finalize` → UPDATE etl_log status=success.

Problem: jeśli `batch_items` failuje pośrodku batcha (np. timeout), ponowne wysłanie tego samego batcha zduplikuje pozycje, bo brak `UNIQUE(order_id, line_number)`.

**`/api/etl/gdrive-sync`** (cron):
- `mode=poll`: czyta queue `etl_log.status='queued'`, dequeuje, ustawia running, ale **dodatkowo INSERTuje nowy etl_log z source='gdrive_csv'** → 2 wiersze logu na 1 sync. Cosmetic ale zaśmieca historię.
- `mode=daily`: identyczna ścieżka, brak guardu czy queue jest zajęta.
- DELETE strategy: pobiera istniejące `order_id` w zakresie dat z CSV, deletuje items+orders, potem upsert. To eliminuje stare zamówienia w zakresie dat ALE:
  - Jeśli ERP wyśle CSV bez orderu który był wcześniej (np. usunięty), rekord zostaje **zombie** poza zakresem dat.
  - `created_at` resetuje się przy każdym imporcie (bo wcześniej DELETE).

**Brak**:
- Lock file / mutex.
- Quarantine pliku JSONL.
- `rows_quarantined` w etl_log.
- `details JSONB` w etl_log dla missing_orders, sanity checks.

### 1.5 Display

- `/api/dashboard/database` — generic table preview, OK ale typuje z wartości próbki (zawodne dla nullable kolumn).
- `/api/dashboard/overview` — KPI z `fact_daily_revenue`, top products z `fact_order_items` z inner join. OK.
- `/api/dashboard/products` — używa `fact_order_items.fact_orders!inner(...)` — Supabase PostgREST FK join. **Wymaga FK constraint** — w migracji 001 jest `REFERENCES fact_orders(order_id) ON DELETE CASCADE` ✓.
- `/api/dashboard/revenue` — supplier ranking z `fact_orders.supplier`. Jeśli supplier hand-classification nie pokrywa tagów — KPI fałszywe.
- `/api/dashboard/explorer` — whitelist x/y/group_by, bezpieczne. OK.

**Problem wyświetlania**: jeśli `total_gross_pln` jest `null` (np. dla EUR sklepu bez kursu NBP) — KPI revenue jest niedoszacowany. Ścieżka `getEurPlnRate` ma fallback ale jeśli NBP API failuje, zwraca null → kasa znika z reportu.

---

## TOR 2 — Audyt vs. wymagania promptu (gap analysis)

| # | Wymaganie z prompta | Stan w repo | Priorytet |
|---|---|---|---|
| 1 | `raw_erp_orders` z `csv_row_number`, `etl_run_id`, `loaded_at` | Tabela istnieje, ale bez tych kolumn i nieużywana | **HIGH** |
| 2 | `fact_orders.last_seen_at`, `last_updated_at`, `row_hash` | Brak | **HIGH** |
| 3 | `fact_order_items` UNIQUE(order_id, line_number) | Brak | **HIGH** |
| 4 | `etl_log.id UUID`, `pipeline`, `version`, `details JSONB`, `rows_quarantined`, `status='partial'` | Brak (mamy `BIGSERIAL` id, brak details/version/pipeline) | **MED** |
| 5 | UPSERT z `row_hash` change detection | Brak — DELETE+INSERT zamiast | **HIGH** |
| 6 | Detekcja zamówień "znikniętych" (last_seen_at < CURRENT_DATE - 2d) | Brak | **MED** |
| 7 | Quarantine JSONL fail-soft | Brak | **MED** |
| 8 | Konwersja Europe/Warsaw → UTC dla dat | Brak | **HIGH** (może powodować przesunięcia KPI dziennych) |
| 9 | Cron literalnie 06:00 PL | Cron 06:00 UTC (etykieta UI niezgodna) | **LOW** |
| 10 | Lock file / concurrency guard | Brak | **MED** |
| 11 | Sanity checks po loadzie (orders bez items, items bez orders, suma per sklep) | Brak | **MED** |
| 12 | View `v_orders_with_producer` (whitelist 8 producentów) | Brak — używamy hand-classification w ETL z 18 dostawcami | **MED** |
| 13 | View `v_orders_billable` (status IN sprzedaży/zrealizowane) | Brak — dashboardy filtrują ad-hoc przez `.neq('status','anulowane')` | **MED** |
| 14 | Shoper bez sufiksu → `'shoper_unknown'` + warning | Cicha klasyfikacja przez język opcji | **MED** |
| 15 | Testy: parse_options PL/DE, ffill grouping, upsert idempotent, postal/phone normalization | **0 testów w repo** | **HIGH** |
| 16 | `pillows_*` count columns (40x40, 50x60, 50x70, 70x80) | Parsed w `parseOptions`, ale type i schema ich nie zawierają — wartości tracone | **LOW** |

---

## Dlaczego "wyświetlanie danych" się sypie (hipotezy)

1. **Sklep EUR (mybed.de) bez kursu NBP** → `total_gross_pln=null` → revenue per shop wygląda na niski.
2. **Strefa czasowa** → zamówienia z PL po 22:00 UTC trafiają jako "następny dzień" w `fact_daily_revenue` (klucz daty `order_date.substring(0,10)`).
3. **Re-import bez idempotencji** → po manualnym uploadzie zamówienia z `created_at` resetują się; jeśli aplikacja gdzieś używa `created_at` (nie sprawdziłem), liczby są fałszywe.
4. **Status string contract** → KPI "anulowane" zlicza tylko literal `'anulowane'`. Jeśli ERP kiedyś zmieni etykietę (np. `"Anulowano przez klienta"`), `normalizeStatus` zwróci `"anulowane"` ✓ — ale nieoczekiwany wariant trafia do `unknown`.
5. **Dostawca w supplier ranking** = klasyfikacja z `KNOWN_SUPPLIERS` — różni się od whitelist'y produkcyjnej (np. brak `RELAX`). Wykres dostawców ma "puste" miejsca dla rzeczywistych producentów.
6. **`fact_agency_costs`** w `TABLES` w `/api/dashboard/database` ale **brak migracji** — endpoint zwraca pustą tabelę, w UI miga błąd "0 rows".

---

## Co potrzebuję od Ciebie żeby ruszyć implementację (Tor 3 — następny krok)

1. **Potwierdzenie schematu w produkcyjnej Supabase** — uruchom (lub daj mi creds):
   ```sql
   SELECT table_name, column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name IN ('raw_erp_orders','fact_orders','fact_order_items','etl_log')
   ORDER BY table_name, ordinal_position;
   ```
   Chcę wiedzieć czy migracje 001 zostały zastosowane 1:1, czy ktoś już coś dodał ręcznie.

2. **Przykładowe `Numer`** dla anomalii Shoper bez `-1`/`-2` — żeby napisać sensowny test.

3. **Whitelista producentów** — czy jeśli wyciągam producenta z tagów, ma to być **8** z prompta (Comfy, Profoam, MOBLER, Mazur, RELAX, Tobi One, VONGAI, Włodex), czy obecne **18** w `KNOWN_SUPPLIERS` (które jest superset)? Sugeruję whitelistę 8 + pozostałe lądują w `operational_tags` zamiast w `supplier`.

4. **Decyzja: czy zostajemy przy Next.js+Supabase czy dorzucamy Python+psycopg2 na VPS** zgodnie z literą prompta? Moja rekomendacja: **zostać przy Next.js**, bo:
   - GDrive sync już działa w Vercel Cron.
   - Dwa pipeline'y to dwa źródła prawdy → dryf.
   - Możemy zaimplementować WSZYSTKIE wymagania prompta (idempotencja, quarantine, audit, lock) w obecnym stacku.
   - Jeśli mimo to chcesz Python — robię osobny katalog `erp_pipeline/` zgodnie ze szkicem z pkt 9 i wyłączamy Vercel cron.

---

## Definition of Done (po Twojej akceptacji)

Patrz `csv-pipeline-plan.md` w tym katalogu — szczegółowy plan migracji + zmian kodu + testów.
