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

### WAŻNE — używaj widoku v_order_items zamiast fact_order_items
fact_order_items miesza realne produkty z darmowymi próbkami tkanin, a ich
kategoryzacja jest niespójna między sklepami. Dlatego do KAŻDEGO pytania o
produkty, modele, bestsellery lub próbki używaj widoku **v_order_items**.

## v_order_items — fact_order_items + flaga is_sample
Ma WSZYSTKIE kolumny fact_order_items oraz dodatkowo:
- is_sample (boolean) — TRUE = próbka tkaniny (darmowa, nazwana jak tkanina
  np. "Melody 13"), FALSE = realny produkt lub pozycja logistyczna.

### Reguła dla rankingów / sprzedaży
- Realne produkty / bestsellery / "top modele" → v_order_items
  WHERE is_sample = false AND item_type = 'product'
- Tylko próbki tkanin → WHERE is_sample = true
- Konkretnie łóżka → dodatkowo AND product_category = 'łóżko'
  (UWAGA: mittohome.pl sprzedaje głównie sofy, narożniki i szafki — nie łóżka;
   dla pytań ogólnych o "produkty" nie zawężaj do kategorii 'łóżko')
- Pozycje logistyczne wyklucza już warunek item_type = 'product'
  (poza nim są 'shipping' / 'service' / 'surcharge').
- Nie używaj samego product_category do odsiewania próbek — bywa błędne
  (próbki bywają oznaczone 'inne', a nawet 'łóżko'). Ufaj fladze is_sample.

## fact_daily_revenue — dzienny przychód (ziarno: date + source_shop, prelagregowane)
- date (date), source_shop
- orders_count, orders_paid, orders_cancelled
- revenue_gross_pln, revenue_paid_pln, shipping_revenue_pln, avg_order_value_pln
- revenue_beds, revenue_mattresses, revenue_accessories, revenue_furniture, revenue_other

## fact_daily_adspend — dzienne wydatki reklamowe (ziarno: date + platform + campaign_id)
- date, platform (na razie tylko 'meta'), account_id, campaign_id, campaign_name, adset_name
- impressions, clicks, spend (w PLN), conversions, conversion_value, cpc, cpm, ctr, roas

### Mapowanie account_id → sklep (Meta Ads)
Tabela NIE ma kolumny source_shop. Przypisanie wydatku do sklepu robisz po account_id:
  - 'act_1681802382204753' → 'mybed.pl'
  - 'act_637792865917248'  → 'mybed.de'
  - 'act_797212915921530'  → 'mittohome.pl'
Wzorzec SQL dla „spend per sklep per miesiąc":
  SELECT date_trunc('month', date)::date AS month,
         CASE account_id
           WHEN 'act_1681802382204753' THEN 'mybed.pl'
           WHEN 'act_637792865917248'  THEN 'mybed.de'
           WHEN 'act_797212915921530'  THEN 'mittohome.pl'
         END AS shop,
         ROUND(SUM(spend)::numeric, 0) AS spend_pln
  FROM fact_daily_adspend
  WHERE platform = 'meta'
  GROUP BY 1, 2 ORDER BY 1, 2;
Sklepy Amazon/Allegro/Kaufland nie mają osobnych kont Meta — ich wydatki idą zwykle przez konto mybed.de lub nie są tam mierzone.
Google Ads spend NIE jest w tej tabeli — szukaj w fact_daily_traffic.ad_cost (patrz niżej).

## fact_daily_traffic — ruch GA4 + Google Ads spend (ziarno: date + source + medium + hostname + campaign)
- date, source, medium, campaign, hostname (= sklep: mybed.pl / mybed.de / mittohome.pl)
- sessions, users, new_users, pageviews, bounce_rate, avg_session_duration, transactions, ga_revenue, ad_cost

### WAŻNE — Google Ads spend
Wydatki Google Ads są w kolumnie ad_cost, w SPECJALNYCH wierszach source = '__total__'
(GA4 raportuje dzienny ad_cost tylko jako dzienne podsumowanie, nie per kampania).
Dla spend per sklep użyj hostname (sklep = hostname, bez mapowania).
UWAGA — WALUTA: ad_cost i ga_revenue są w walucie property GA4: PLN dla mybed.pl
i mittohome.pl, ale EUR dla mybed.de. Tabela nie ma kolumny waluty. Aby zwrócić
spójną kwotę w PLN, przemnóż wartości dla mybed.de przez kurs EUR→PLN dnia.
Kursy są w fact_orders.exchange_rate (currency='EUR'); dim_exchange_rates jest puste.

Wzorzec SQL „Google Ads spend per sklep per miesiąc" (z konwersją EUR→PLN):
  WITH eur AS (
    SELECT order_date::date AS d, AVG(exchange_rate) AS rate
    FROM fact_orders WHERE currency = 'EUR' GROUP BY 1
  )
  SELECT date_trunc('month', t.date)::date AS month,
         t.hostname AS shop,
         ROUND(SUM(t.ad_cost * CASE WHEN t.hostname = 'mybed.de'
                                    THEN COALESCE(eur.rate, 4.30)
                                    ELSE 1 END)::numeric, 0) AS google_spend_pln
  FROM fact_daily_traffic t
  LEFT JOIN eur ON eur.d = t.date
  WHERE t.source = '__total__'
  GROUP BY 1, 2 ORDER BY 1, 2;
Widget „Google Ads Spend" oraz miary explorera (google_spend, ga_revenue)
przeliczają tę walutę automatycznie — niezależne SQL musi to zrobić ręcznie.

Do zwykłej analizy ruchu (sesje/transakcje per source/medium) filtruj source <> '__total__'.

## fact_daily_ad_performance — metryki na poziomie reklamy (ziarno: date + platform + ad_id)
- date, platform, account_id, campaign_id/name, adset_id/name, ad_id/name, creative_id
- impressions, reach, clicks, spend, conversions, conversion_value, cpc, cpm, ctr, roas, frequency
- video_play_3s, video_p25_watched, video_p50_watched, video_p75_watched, video_p95_watched, video_p100_watched, thruplays
- Mapowanie account_id → sklep takie same jak w fact_daily_adspend (patrz wyżej).

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

- x_axis (oś X / wymiar):
  Z fact_orders: "date" | "source_shop" | "source_platform" | "supplier" | "delivery_city" | "status" | "coupon_code"
  Z fact_order_items: "product_category" | "fabric_collection" | "bed_size" | "mattress_type" | "headboard_height"

- y_axis (metryka — wybór y_axis decyduje też o źródle danych):
  Z fact_orders / pozycji: "revenue_gross" | "revenue_paid" | "shipping_revenue" | "orders_count" | "orders_paid" | "orders_cancelled" | "avg_order_value" | "quantity"
  Z fact_daily_adspend (Meta Ads): "meta_spend" | "meta_impressions" | "meta_clicks" | "meta_conversions" | "meta_ctr" | "meta_cpc"
  Z fact_daily_traffic (ruch + Google Ads): "google_spend" | "sessions" | "users" | "transactions" | "ga_revenue" | "pageviews"

- group_by (opcjonalna seria, "" = brak): "source_shop" | "source_platform" | "supplier" | "status" | "delivery_city" | "product_category" | "fabric_collection" | "bed_size" | "mattress_type" | "headboard_height"

- granularity (gdy x_axis = "date"): "day" | "week" | "month" | "quarter"

- filters_advanced: tablica { field, operator, value, value_to? }
  - field: source_shop, source_platform, supplier, status, delivery_city, coupon_code,
    product_name, product_category, fabric_collection, fabric, bed_size, mattress_type,
    headboard_height, storage_type, total_gross_pln, quantity, is_sample
  - operator: eq, neq, contains, not_contains, starts_with, ends_with, in, gt, gte, lt, lte, between, is_null, not_null
  - is_sample to filtr logiczny: value "true" (tylko próbki) lub "false" (tylko realne produkty)

WAŻNE — dopasowanie x_axis do y_axis:
- Miary Meta (meta_*) i ruchu (sessions / google_spend / transactions / users / ga_revenue / pageviews) sensownie reagują tylko na x_axis = "date" lub "source_shop" (+ "source_platform"). Inne osie X dadzą jeden zbiorczy słupek "Łącznie".
- Wymiary z poziomu pozycji (product_category, fabric_collection, bed_size, mattress_type, headboard_height) działają TYLKO z miarami z zamówień (revenue/orders/quantity).
- Sklep w meta jest dedukowany z account_id; w ruchu sklep = hostname.

Widgety i KPI renderuje istniejący silnik (/api/dashboard/explorer) — używaj tylko wartości z powyższych list.`;
