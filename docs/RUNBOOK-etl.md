# Runbook — pipeline ERP CSV → Supabase

## Co się stało (wrzesień 2026)

Dashboard pokazywał dane do 2026-09-02, mimo że marketing i ruch szły na bieżąco.
Przyczyną był cron `gdrive_csv`, który **nie ukończył ani jednego przebiegu od 2026-04-28**
(2 sukcesy, 138 porażek w `etl_log`).

Sygnatura w logach:

```
source=gdrive_csv status=failed started_at=04:00:24 finished_at=04:50:00
error='Auto-closed stale running ETL run (>45 min without finalize)'
```

Przebieg startował o 04:00, Vercel ubijał funkcję po `maxDuration=300 s`, więc `finally`
nigdy się nie wykonywało. Wiersz zostawał w stanie `running`, a kolejne wywołanie
zamykało go jako przeterminowany 45 min później.

Dlaczego nie mieścił się w 300 s — trzy koszty, każdy liniowy względem całej historii:

1. **Pełny zrzut CSV do `raw_erp_orders` przy każdym przebiegu.** Bez deduplikacji
   i bez retencji: ~440 insertów zanim zapisał się choć jeden wiersz faktu.
   Tabela urosła do **30,6 mln wierszy przy 49 tys. zamówień** (~620 wierszy na zamówienie).
2. **`rebuildDailyRevenue`** pobierał wszystkie zamówienia z zakresu przez PostgREST
   i grupował je w JS.
3. **`rebuildDimTables`** dwukrotnie stronicował wszystkie 154 tys. pozycji zamówień
   (po 1000 na żądanie) i grupował w JS.

Razem ~600 round-tripów HTTP. Przebieg ginął w trakcie, ale upserty były już
zacommitowane, więc `fact_orders` posuwało się o kilka tysięcy wierszy na dobę
(liczby były wielokrotnościami `ORDERS_CHUNK`) i utknęło na 2 września.

Skutek uboczny: krok 4 starego kodu **kasował** `fact_daily_revenue` dla zakresu dat,
a agregacja ginęła przed ponownym wyliczeniem — tabela została **pusta (0 wierszy)**.

## Co naprawiono

- Agregacje przeniesione do bazy: `fn_rebuild_daily_revenue`, `fn_rebuild_dim_products`,
  `fn_rebuild_dim_fabrics`. Trzy instrukcje zamiast ~600 round-tripów.
- `raw_erp_orders` zapisywane tylko gdy `ETL_RAW_LANDING=1` (domyślnie wyłączone),
  z retencją przez `fn_purge_raw_erp_orders`.
- Fakty zapisywane **przed** landingiem — audyt nigdy nie zjada budżetu dashboardu.
- Budżet czasu `TIME_BUDGET_MS=240 s`: przebieg kończy się sam i zapisuje status
  `partial`, zamiast zostać ubity w połowie.

## Doba rozliczeniowa: Europe/Warsaw

`fn_rebuild_daily_revenue` grupuje po dobie **warszawskiej**.

Stary kod JS obcinał string ISO w UTC (`order_date.substring(0,10)`), więc zamówienia
złożone między 00:00 a 02:00 czasu lokalnego lądowały na **poprzednim** dniu — podczas
gdy `/api/dashboard/widgets` liczył je przez `warsawDateKey()`. Ta sama metryka miała
dwie wartości zależnie od podstrony. Teraz obie liczą tak samo.

## Zadania operacyjne

### Ręczne przeliczenie agregatów

```sql
select fn_rebuild_daily_revenue('2026-01-01', current_date);
select fn_rebuild_dim_products();
select fn_rebuild_dim_fabrics();
```

### Wyczyszczenie zaległości w raw_erp_orders

30,6 mln wierszy. **Nie kasuj jednym `DELETE`** — to długa transakcja i duży WAL.
Partiami:

```sql
-- powtarzaj aż zwróci 0
with doomed as (
  select id from raw_erp_orders
  where loaded_at < now() - interval '7 days'
  limit 50000
)
delete from raw_erp_orders r using doomed d where r.id = d.id;
```

Potem `VACUUM (ANALYZE) raw_erp_orders;` żeby odzyskać miejsce.

Jeśli landing ma wrócić, najpierw indeks (poza transakcją):

```sql
create index concurrently idx_raw_erp_orders_etl_run on raw_erp_orders (etl_run_id);
```

### Diagnostyka przebiegu

```sql
select source, status, started_at, finished_at,
       rows_processed, rows_quarantined, details->>'duration_ms' ms,
       details->>'truncated' truncated, error_message
from etl_log order by started_at desc limit 20;
```

`truncated=true` oznacza, że przebieg dobił do budżetu czasu — uruchom ponownie,
upserty są idempotentne (`row_hash`).

## Wymagane zmienne środowiskowe

| Zmienna | Rola |
|---|---|
| `SUPABASE_SERVICE_KEY` | **Wymagana.** Brak = błąd startu. Nie ma już cichego zejścia na klucz anon. |
| `CRON_SECRET` | Ustawiana na projekcie Vercel; Vercel Cron wysyła ją jako `Authorization: Bearer`. |
| `ETL_CRON_SECRET` | Sekret dla wywołań ręcznych / service-to-service. Akceptowany równolegle z `CRON_SECRET`. |
| `SENSMAX_CRON_SECRET` | Jak wyżej, dla `/api/sensmax/sync`. |
| `ETL_RAW_LANDING` | `1` włącza zapis do `raw_erp_orders`. Domyślnie wyłączone. |
| `ETL_RAW_LANDING_KEEP_RUNS` | Ile przebiegów zachować (domyślnie 3). |

> **Uwaga przy wdrożeniu:** autoryzacja cronów jest teraz *fail-closed*. Jeśli ani
> `CRON_SECRET`, ani `ETL_CRON_SECRET` nie są ustawione, endpointy zwracają 503
> i **żaden cron nie zadziała**. Ustaw `CRON_SECRET` przed wdrożeniem.
