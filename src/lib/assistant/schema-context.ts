// Statyczny opis modelu danych dla asystenta AI. Wstrzykiwany do system
// promptu (z cache) oraz zwracany przez narzędzie get_schema. Obejmuje
// WYŁĄCZNIE tabele, do których rola ai_readonly ma GRANT SELECT (migracja 008).

export const DB_SCHEMA_DESCRIPTION = `# Model danych — MyBed Group (e-commerce meblowy)

Wszystkie kwoty są w PLN (kolumny *_pln). Dane analityczne, tylko do odczytu.

## fact_orders — zamówienia (ziarno: jedno zamówienie)
- order_id (text, PK), order_date (timestamptz), expected_date, fulfillment_date
- source_platform (text: woocommerce, amazon, allegro, kaufland, showroom...)
- source_shop (text: mybed.pl, mybed.de, mittohome.pl, showroom, amazon.de, allegro.pl, kaufland.de)
- currency, total_gross (oryginalna waluta), total_gross_pln, shipping_cost_pln, exchange_rate
- is_paid (bool), status (text), coupon_code, delivery_city, delivery_zip, delivery_method
- supplier (text), production_batch, sales_person, marketplace_tag, operational_tags (text[])
- customer_name, customer_email_hash (zahaszowany)

## fact_order_items — pozycje zamówień (ziarno: linia zamówienia)
- order_id (text, FK -> fact_orders.order_id), line_number
- product_name — nazwa pozycji (UWAGA: może to być model łóżka, mebel ALBO próbka tkaniny)
- product_category — kategoria pozycji (lista niżej)
- item_type — 'product' | 'shipping' | 'service' | 'surcharge'
- quantity, bed_size, mattress_type, fabric, fabric_collection, headboard_height, storage_type

### WAŻNE — próbki tkanin vs. realne produkty
fact_order_items zawiera ZARÓWNO realne produkty, JAK I darmowe próbki tkanin.
Próbka tkaniny ma product_name = nazwa tkaniny + numer odcienia, np. "Melody 13",
"Find Me 2", "Storm 2", "Golden 21", "Legend 1". To NIE są modele łóżek.
Kategoryzacja próbek jest NIESPÓJNA między sklepami:
  - mybed.pl / mybed.de: próbki mają product_category = 'próbki'
  - mittohome.pl: próbki mają product_category = 'inne' (ten sklep nie używa 'próbki')

Wartości product_category:
  - realne produkty: 'łóżko', 'materac', 'sofa', 'fotel', 'pufa', 'meble',
    'meble-dziecięce', 'poduszka', 'kołdra', 'koc', 'dekoracje', 'zestaw', 'pielęgnacja'
  - NIE-produkty (wykluczaj z rankingów modeli/sprzedaży): 'próbki', 'inne',
    'wysyłka', 'usługa', 'dopłata', 'voucher', 'konfigurator', 'SKU-kodowany'

### Reguła dla rankingów modeli / bestsellerów / sprzedaży produktów
- "Top modele łóżek", "najlepiej sprzedające się łóżka" → WHERE product_category = 'łóżko'
- "Top produkty" ogólnie → WHERE item_type = 'product' AND product_category NOT IN
  ('próbki','inne','wysyłka','usługa','dopłata','voucher','konfigurator','SKU-kodowany')
- ZAWSZE wykluczaj też item_type IN ('shipping','service','surcharge').
- Jeśli NIE wykluczysz próbek, ranking dla mittohome.pl pokaże same nazwy tkanin
  (np. "Melody 13") zamiast modeli — to błędna odpowiedź.

## fact_daily_revenue — dzienny przychód (ziarno: date + source_shop, prelagregowane)
- date (date), source_shop
- orders_count, orders_paid, orders_cancelled
- revenue_gross_pln, revenue_paid_pln, shipping_revenue_pln, avg_order_value_pln
- revenue_beds, revenue_mattresses, revenue_accessories, revenue_furniture, revenue_other

## fact_daily_adspend — dzienne wydatki reklamowe (ziarno: date + platform + campaign_id)
- date, platform (meta, google, pinterest), campaign_id, campaign_name, adset_name
- impressions, clicks, spend, conversions, conversion_value, cpc, cpm, ctr, roas

## fact_daily_traffic — ruch GA4 (ziarno: date + source + medium + hostname + campaign)
- date, source, medium, campaign, hostname
- sessions, users, new_users, pageviews, bounce_rate, avg_session_duration, transactions, ga_revenue

## fact_daily_ad_performance — metryki na poziomie reklamy (ziarno: date + platform + ad_id)
- date, platform, account_id, campaign_id/name, adset_id/name, ad_id/name, creative_id
- impressions, reach, clicks, spend, conversions, conversion_value, cpc, cpm, ctr, roas, frequency
- video_play_3s, video_p25_watched, video_p50_watched, video_p75_watched, video_p95_watched, video_p100_watched, thruplays

## dim_exchange_rates — kursy walut: date, currency, rate_to_pln, source
## dim_products — słownik produktów: product_name (PK), product_category, total_orders, total_quantity, first_sold, last_sold
## dim_fabrics — słownik tkanin: fabric_name (PK), fabric_collection, total_orders
## dim_creatives — kreacje reklamowe: creative_id (PK), account_id, title, body, format, aspect_ratio, ai_tags (text[]), is_dynamic
## etl_log — log importów: id, source, started_at, finished_at, status, rows_processed/inserted/updated/deleted

## Wskazówki do SQL
- Łączenie zamówień z pozycjami: fact_orders o JOIN fact_order_items i ON o.order_id = i.order_id
- Do trendów dziennych najtaniej używać fact_daily_revenue (już zagregowane).
- Filtry dat: order_date to timestamptz, date to date.
- Pytania o modele/produkty/bestsellery: pamiętaj o regule wykluczania próbek opisanej wyżej.
- Zawsze pisz jawne nazwy kolumn, agreguj w SQL (GROUP BY) zamiast pobierać wszystkie wiersze.`;

// Whitelista metryk i wymiarów dla narzędzi create_widget / create_kpi.
// Te wartości muszą być zgodne z src/lib/explorer-whitelist.ts.
export const WIDGET_SPEC_REFERENCE = `# Specyfikacja widgetu / KPI (config custom_explorer)

Pola configa:
- chart_type: "bar" | "line" | "area" | "pie" | "table"
- x_axis (oś X / wymiar): "date" | "source_shop" | "product_category" | "fabric_collection" | "supplier" | "source_platform"
- y_axis (metryka): "revenue_gross" | "orders_count" | "avg_order_value" | "quantity"
- group_by (opcjonalna seria, "" = brak): "source_shop" | "product_category" | "supplier" | "source_platform" | "fabric_collection"
- granularity (gdy x_axis = "date"): "day" | "week" | "month" | "quarter"
- filters_advanced: tablica { field, operator, value, value_to? }
  - field: source_shop, source_platform, supplier, status, delivery_city, coupon_code,
    product_name, product_category, fabric_collection, fabric, bed_size, headboard_height,
    storage_type, total_gross_pln, quantity
  - operator: eq, neq, contains, not_contains, starts_with, ends_with, in, gt, gte, lt, lte, between, is_null, not_null

Widgety i KPI renderuje istniejący silnik (/api/dashboard/explorer) — używaj tylko wartości z powyższych list.`;
