# Przełączenie dashboardu na panel-zamowien (Mybed2) — przegląd i plan

Stan na 2026-11-19. Przegląd kodu produkcyjnego (Vercel `base`, gałąź `claude/happy-bell-6no4qg`, commit `c2aa74a`)
oraz danych w projekcie Supabase **panel-zamowien** (`mvumyvqoygfepfyuoamd`, organizacja Mybed2).
Wszystkie zapytania do panelu były tylko do odczytu.

---

## TL;DR

1. **W panelu są trzy różne źródła zamówień, a tylko jedno z nich jest nowe.**
   - `erp_zamowienia` to **ten sam `Eksport.csv` z IdeaERP** (Google Drive), z którego dashboard korzysta dziś — tylko okrojony:
     pozycje mają wyłącznie nazwę i ilość (bez tkaniny, rozmiaru, materaca, wezgłowia, stelaża), nie ma miasta klienta,
     data jest bez godziny, odświeżanie raz dziennie (09:20 UTC), okno 120 dni. Przepięcie dashboardu na tę tabelę
     **nie da pewniejszych danych** i wyłączy 9+ widgetów.
   - `sklep_zamowienia` — **prawdziwe API sklepów** (Shoper: mybed.pl, mybed.de, mojepostel.cz; Shopify: mittohome.pl;
     Medusa: nomosleep.pl), co 10 minut, z opcjami produktów, cenami pozycji, godziną i miastem klienta, z poprawną walutą CZK.
     Ale: działa w trybie „cień”, komplet zamówień jest dopiero **od 2026-11-04**, nie obejmuje ZAM/ (showroomy), Amazon,
     Kaufland, Allegro i **nie odróżnia „Oferta” od „Zamówienie sprzedaży”**.
   - `orders` — zlecenia do producentów (od XII 2024): **pewny producent** (`producer_code`) per zlecenie — wyraźnie lepszy
     niż dzisiejsze zgadywanie producenta z tagów ERP.
2. **Rekomendacja: panel jako źródło, baza dashboardu jako hurtownia (replika).** Nowy job `panel-sync` (co 10 min)
   zastępuje parsowanie CSV z Drive i zapisuje do tych samych `fact_orders` / `fact_order_items`. Endpointy KPI zostają
   bez zmian, a zmiana dotyczy jednego miejsca (ETL), nie kilkunastu endpointów. Historia sprzed przełączenia zostaje.
   Nie podpinamy endpointów dashboardu bezpośrednio pod panel (powody w sekcji 4).
3. **„Szybciej” ma dwa znaczenia i tylko jedno załatwia samo przełączenie:**
   - świeżość danych: dziś realnie **~1 dzień opóźnienia** (sync 04:00 UTC odpala się *przed* zapisaniem eksportu),
     po przełączeniu ~10 minut — tak;
   - szybkość ładowania widgetów: **nie poprawi się od samej zmiany źródła**. Każdy widget pobiera wszystkie zamówienia
     z zakresu stronami po 1000 i liczy w Node. To trzeba naprawić agregacją w SQL (etap 4).
4. **Część KPI liczy się dziś źle niezależnie od źródła** (sekcja 2) — warto to naprawić przed przełączeniem, żeby
   porównanie „stare vs nowe” w trybie cienia nie mieszało dwóch różnych zmian.

---

## 1. Jak to działa dziś

```
IdeaERP ──(Eksport.csv, Google Drive, zapis ~05:00–08:00 UTC)──┬──> dashboard: /api/etl/gdrive-sync (Vercel cron 04:00 UTC)
                                                                │      └─> fact_orders / fact_order_items / fact_daily_revenue ──> KPI
                                                                └──> panel: erp-zamowienia (pg_cron 09:20 UTC) ──> erp_zamowienia
Sklepy (Shoper/Shopify/Medusa API) ──(co 10 min, tryb „cień”)──────> panel: sklep_zamowienia
```

- Produkcja to gałąź `claude/happy-bell-6no4qg`; `main` i starsze gałęzie są ~119 commitów w tyle. Implementację trzeba
  robić na bazie produkcyjnej gałęzi.
- CFO Studio (projekt `mybed-finance`) już czyta panel przez `postgres_fdw` (serwer `panel_zamowien`) — ten sam wzorzec
  można wykorzystać.

## 2. Problemy w obecnych KPI (niezależne od migracji)

| # | Problem | Skala / dowód | Gdzie |
|---|---|---|---|
| 1 | **Opóźnienie danych o ~1 dzień.** Automatyczny sync jest raz dziennie o 04:00 UTC, a ERP zapisuje `Eksport.csv` później (7.11: 05:03 UTC, 19.11: 08:03 UTC). 19.11 o 04:00 dashboard wczytał wczorajszy plik (304 818 wierszy wobec 304 873 w nowym). Tryb `poll` co 10 min działa tylko dla ręcznie zakolejkowanych żądań. 16.11 sync się wysypał (0 wierszy) i nikt go nie powtórzył. | `etl_log`, `vercel.json` | `src/app/api/etl/gdrive-sync/route.ts:77-93` |
| 2 | **„Revenue brutto”, AOV, „Revenue w czasie”, Przegląd, Pivot, Eksplorator, Insights, Pogoda i `fact_daily_revenue` sumują wszystkie statusy** — także oferty i anulowane. Widok `v_orders_billable` istnieje, ale nic go nie używa. Komentarz w overview mówi „only billable”, kod tego nie robi. Anulowane liczone raz regexem, raz dokładnym `'anulowane'`. Październik, mybed.pl: 6,57 mln zł we wszystkich statusach vs 6,06 mln zł w „Zamówienie sprzedaży” + „Zrealizowane” (**+8%**). | `erp_zamowienia` X 2026 | `widgets/route.ts:242` (`getKpiTotals`), `overview/route.ts`, `revenue/route.ts` |
| 3 | **Ranking / podział dostawców jest niepełny.** Whitelista ma 8 producentów (Comfy, Profoam, MOBLER, Mazur, RELAX, Tobi One, VONGAI, Włodex), a zlecenia od 1.10 ma w panelu 15 dostawców (Milanik, AG, Kijak, PW Meble, Karol, Panek, Brewus, Rabiega… nie istnieją w dashboardzie). Od 1.10 **287 zamówień łóżek/materacy/sof za 1,06 mln zł nie ma producenta**. Całe zamówienie dostaje pierwszy pasujący tag, więc Profoam (materace) ma 79 zamówień w dashboardzie wobec 652 zleceń w panelu (wszystkie rynki). RELAX i VONGAI z whitelisty są dziś archiwalni. | `finance.erp_orders`, `panel.orders` | `src/lib/erp-parser.ts` (`PRODUCER_WHITELIST`, `classifyTags`) |
| 4 | **mojepostel.cz (Shoper…-3) liczony w złotówkach.** Parser daje `shoper_unknown` / PLN, a kwoty są w CZK (np. 5 zamówień z API = 94 tys. CZK ≈ 16 tys. zł, a dashboard liczy je jako 94 tys. zł). Panel `erp_zamowienia` ma ten sam błąd (rynek PL). Tylko API ma poprawne `CZK`. | 9 zamówień od 24.10 | `erp-parser.ts` `detectSource` |
| 5 | **Różne granice dnia na różnych stronach.** Przegląd, Revenue, Produkty, Pivot, Eksplorator, Insights i Pogoda filtrują `order_date` po UTC (`dateTo + 'T23:59:59'`, klucz dnia `slice(0,10)`), a „Mój Dashboard” i `fact_daily_revenue` liczą po czasie warszawskim. Ten sam dzień daje różne liczby (zamówienia z 00:00–01:00/02:00 PL lądują w innym dniu). | — | `overview`, `revenue`, `products`, `pivot`, `explorer`, `insights`, `weather` |
| 6 | **Ucinanie do 1000 wierszy (limit PostgREST).** `.limit(50000)` / `.limit(20000)` bez stronicowania: strona Produkty, Eksplorator (zamówienia i pozycje — miesiąc mybed.pl to już >1000 zamówień), kurs EUR w `ad-cost.ts`, tryb „all” w `sensmax/historical`. Wyniki liczą się z wycinka danych. | — | `products/route.ts`, `explorer/route.ts:102,126`, `lib/ad-cost.ts:34` |
| 7 | **Widget „Próbki tkanin” (`table_fabric_samples`) jest w katalogu, ale API go nie obsługuje** → błąd „Unknown widget”. | — | `widget-definitions.ts` vs `widgets/route.ts` |
| 8 | **`raw_erp_orders` ma ~30,6 mln wierszy** (estymata ze statystyk tabeli) mimo funkcji `fn_purge_raw_erp_orders`. Do sprawdzenia, czy purge działa — to koszt i spowolnienie bazy. | `list_tables` | `gdrive-sync/route.ts:397` |
| 9 | **Szybkość widgetów**: każdy KPI/ranking pobiera wszystkie zamówienia z zakresu (stronami po 1000), a pozycje — w kawałkach po 500 `order_id`. 10 kart KPI = 10 pełnych skanów. Przy roku danych to dziesiątki zapytań na widget. | — | `widgets/route.ts` (`fetchAllRows`, `iqSafe`) |

| 10 | **Pivot ignoruje filtry pozycji i metrykę „ilość”.** Filtry po polach pozycji przechodzą walidację, ale nie są stosowane; `quantity` jest na liście metryk, a zawsze daje 0. | — | `pivot/route.ts:252-253` |
| 11 | **Eksplorator dzieli przychód zamówienia na pozycje po ilości, łącznie z darmowymi próbkami** — łóżko + próbka = próbka dostaje 50% przychodu. | — | `explorer/route.ts:193-195` |
| 12 | **Insights (podpowiedzi AI w „Mój Dashboard”)**: „revenue” kategorii to w rzeczywistości suma sztuk; top produkty nie wykluczają próbek. | — | `insights/route.ts:201-206` |
| 13 | **Mattress-attach** bez filtra próbek (np. próbki mittohome z „bett” w nazwie wpadają jako łóżka); toppery liczą się jako materace. | — | `mattress-attach/route.ts`, `erp-parser.ts` |
| 14 | **Stronicowanie bez `.order()`** (Pivot, Mattress-attach, Insights, Pogoda) — kolejne strony mogą gubić lub powtarzać wiersze. | — | `pivot:247`, `mattress-attach:47`, `insights:140,173`, `weather:87` |
| 15 | **Asystent AI dostaje błędny opis danych**: wartości `showroom` / `woocommerce`, których ETL nie zapisuje (showroomy to `manual`), i kolumny `revenue_beds…revenue_other`, które są zawsze puste. | — | `lib/assistant/schema-context.ts:11-12,53` |

**Pilne, bezpieczeństwo (niezależne od migracji):** migracja 022 odbiera `EXECUTE` na funkcjach `SECURITY DEFINER`
`fn_purge_raw_erp_orders`, `fn_rebuild_daily_revenue`, `fn_rebuild_dim_products`, `fn_rebuild_dim_fabrics` tylko rolom
`anon, authenticated`, a nie `PUBLIC` — choć kilka linii niżej ta sama migracja zauważa, że bez `PUBLIC` to nic nie zmienia.
Według plików migracji ktokolwiek z publicznym kluczem anon (jest w bundlu przeglądarki) może wywołać czyszczenie `raw_erp_orders`
albo przebudowę agregatów. Stanu uprawnień w bazie nie sprawdziłem (projekt dashboardu jest w innej organizacji niż obecnie
podpięta do Supabase MCP). Poprawka:

```sql
REVOKE EXECUTE ON FUNCTION fn_purge_raw_erp_orders(integer)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_rebuild_daily_revenue(date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_rebuild_dim_products()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_rebuild_dim_fabrics()           FROM PUBLIC, anon, authenticated;
```

## 3. Co jest w panelu i czy KPI zadziałają

### 3.1 Źródła w panelu

| Tabela | Skąd | Świeżość | Zakres | Ma | Nie ma |
|---|---|---|---|---|---|
| `erp_zamowienia` (57 146) | `Eksport.csv` z Drive (ten sam co dashboard) | 1×/dzień 09:20 UTC, okno 120 dni | od 2025-01 | numer, kanał, rynek PL/DE, waluta, **dzień**, status ERP, zapłacone, suma, koszt dostawy, metoda dostawy, kupon, tagi, pozycje (nazwa, ilość) | godziny, **opcji pozycji**, **miasta/kodu** (celowo — bez danych klientów), kursu walut, CZK |
| `sklep_zamowienia` (2 278) | API sklepów | co 10 min | komplet od **2026-11-04** | timestamp, status sklepu, opłacone, suma, waluta (EUR/CZK poprawnie), koszt dostawy, kupon, rabaty, **pozycje z opcjami, SKU i ceną**, **miasto/kod/kraj** | ZAM/, Amazon, Kaufland, Allegro, historii, rozróżnienia Oferta/Zamówienie sprzedaży, „zapłacone” dla przelewów/pobrań oznaczanych ręcznie w ERP |
| `orders` (33 681) | zlecenia do producentów | na bieżąco | od 2024-12 (legacy import) | **producer_code**, rynek, data, produkty z opcjami, status produkcji, daty wysyłki | próbek, wysyłki, usług; jedno zamówienie = kilka zleceń |
| `order_costs`, `order_shipping`, `complaints`, `erp_faktury` | panel | na bieżąco | od IX 2026 pełne | koszt produkcji, koszt dostawy, reklamacje, faktury | — |

Zgodność API ↔ ERP (zamówienia sklepowe od 1.11, 1 581 sparowanych):

- kwota: 3 różnice; dzień zamówienia: 1 różnica — **zgodne**;
- anulowane: status sklepu 4 = „Anulowano” w ERP — **zgodne**;
- „Oferta” vs „Zamówienie sprzedaży”: oba występują przy statusie sklepu 2 (w realizacji) — **z API nie da się odtworzyć dzisiejszej definicji sprzedaży**;
- zapłacone: 21 zamówień zapłaconych w ERP, a nieopłaconych w API (przelew/pobranie oznaczane ręcznie), 4 odwrotnie;
- kupon: 48 różnic (nie sprawdziłem jeszcze, po której stronie brakuje kuponu) — do wyjaśnienia;
- `sklep_zgodnosc` (dzienna zgodność API↔ERP liczona w panelu) jest **pusta** — nikt jeszcze formalnie nie potwierdził zgodności.

### 3.2 Macierz KPI

Legenda: ✅ działa, ⚠️ działa z warunkiem, ❌ nie da się z tego źródła.

| Grupa KPI (widgety / strony) | Potrzebne dane | `erp_zamowienia` | API `sklep_zamowienia` | `orders` | Werdykt przy replice |
|---|---|---|---|---|---|
| Revenue brutto / opłacone / nieopłacone, Zamówienia, AOV, Wskaźnik płatności, Revenue i zamówienia w czasie, Status płatności, Przegląd, lejek statusów, trend AOV | dzień, sklep, waluta, suma, status, zapłacone | ✅ (bez kursu → tabela NBP) | ⚠️ status Oferta/Sprzedaż i część „zapłacone” tylko z ERP | — | ✅ — status i zapłacone z ERP, API daje „dziś” jako dane wstępne |
| Zamówienia łóżek / sprzedane łóżka / próbki, Ranking modeli, top produkty, kategorie | nazwa, ilość, kategoria | ✅ | ✅ (+SKU) | ⚠️ bez próbek | ✅ |
| Ranking tkanin, kolekcji, rozmiarów, wys. wezgłowia, stelaży, Typ materaca, wykresy strony Produkty, pola pozycji w Eksploratorze/Pivot | opcje pozycji | ❌ | ✅ (ten sam format „Klucz: wartość; …”, obecny parser PL/DE zadziała) | ✅ tylko produkowane | ⚠️ historia zostaje w `fact_order_items`; nowe z API; ZAM/ i marketplace’y — z ERP po dopisaniu opcji (etap 1) |
| Ranking miast, Mapa ciepła, Sprzedaż per miasto | miasto, kod, kraj | ❌ (celowo) | ✅ | ⚠️ `order_customers` | ⚠️ z API kopiujemy **tylko** miasto/kod/kraj; historia zostaje |
| Ranking / podział dostawców, ranking producentów (Revenue) | producent | ⚠️ tagi (luki jak dziś) | ❌ | ✅ **lepiej niż dziś** | ✅ po przejściu na `producer_code` — liczby się zmienią (to poprawka) |
| Ranking kuponów, analiza kuponów | kupon | ✅ | ⚠️ 48 różnic | — | ✅ z ERP, różnice do wyjaśnienia |
| MER, Total marketing spend, Meta/Google spend | revenue + wydatki reklamowe w **tej samej bazie**; kurs EUR z `fact_orders.exchange_rate` | — | — | — | ✅ tylko przy replice (wydatki są w bazie dashboardu); kurs przenieść do `dim_exchange_rates` |
| Showroomy (ZAM/), Amazon, Kaufland, Allegro | wszystko | ✅ | ❌ | — | ✅ z ERP do czasu, aż nowy ERP je przejmie (`showroom_orders` w panelu jest pusta) |
| Pivot, Eksplorator (poziom zamówienia) | dzień, sklep, platforma, dostawca, status, miasto, kupon, suma, dostawa, zapłacone | ⚠️ bez miasta | ✅ | — | ✅ przy replice (miasto jak wyżej) |
| Sprzedaż vs pogoda, Insights | dzień, sklep, suma; pozycje: nazwa, kategoria | ✅ | ✅ | — | ✅ |
| Mattress-attach (materac do łóżka) | kategoria łóżko/materac, nazwa, `mattress_type` (stary konfigurator) | ⚠️ bez `mattress_type` | ✅ | — | ⚠️ jak atrybuty produktu |
| Sprzedaż showroomów (Sensmax) | arkusze Google per showroom | — | — | — | bez zmian — nie korzysta z zamówień |
| GA4, Meta, Sensmax (ruch) | inne źródła | — | — | — | bez zmian |
| Asystent AI, Baza danych | `fact_*` | — | — | — | ✅ bez zmian przy replice; ❌ przy czytaniu wprost z panelu |

Nie korzysta z nich żaden KPI: godzina zamówienia, kod pocztowy, `operational_tags`, `customer_email_hash`. Brak tych pól
w części źródeł niczego więc nie psuje.

## 4. Architektura — rekomendacja

**Panel → replika w bazie dashboardu (rekomendowane).**

- Endpointy KPI, asystent AI, eksplorator, pivot i MER dalej czytają `fact_orders` / `fact_order_items` — zero zmian w ~15 endpointach.
- Wydatki reklamowe, GA4, pogoda i Sensmax są w bazie dashboardu — MER i inne zestawienia nadal łączą się w jednej bazie.
- Panel to system operacyjny (BOK, produkcja, płatności, dane klientów). Dashboard dostaje dostęp **tylko do odczytu, tylko do potrzebnych kolumn**, bez danych osobowych i bez klucza service_role panelu.
- Historia od 2025-01 zostaje w obecnych tabelach (opcje, miasta), więc nic nie ginie.

**Dlaczego nie czytać panelu wprost z endpointów:** trzeba by przepisać wszystkie endpointy, łączyć dane z dwóch baz w Node
(MER, kurs EUR dla Google Ads, pogoda, insights), dać dashboardowi klucz do bazy z PII i płatnościami, a każde
przeładowanie dashboardu skanowałoby bazę operacyjną panelu. I nadal brakowałoby opcji i miast dla historii.

Szczegóły repliki:

- W panelu: schemat `dash` z widokami bez danych osobowych (`dash.v_orders`, `dash.v_order_items`, `dash.v_production_orders`)
  i rola `dash_reader` z `SELECT` tylko na `dash.*`.
- W dashboardzie: `/api/etl/panel-sync` (Vercel cron co 10 min) czyta widoki przez połączenie Postgres jako `dash_reader`,
  używa istniejących funkcji z `erp-parser.ts` (kategorie, opcje PL/DE, kolekcje tkanin) i robi upsert z `row_hash`
  — ta sama ścieżka co dziś, tylko inne wejście. Alternatywa: `postgres_fdw` + `pg_cron` jak w CFO Studio (wymaga
  przeniesienia parsera do SQL — więcej pracy).
- Reguła scalania per zamówienie: **ERP wygrywa** dla statusu, „zapłacone” i kuponu, gdy zamówienie już jest w eksporcie;
  **API** daje zamówienia, których ERP jeszcze nie ma (oznaczone `is_provisional = true`), oraz opcje, miasto, godzinę i walutę.
- Nowe kolumny w `fact_orders`: `source_system` (`erp_csv` / `panel_erp` / `panel_api`), `order_day date` (dzień w Europe/Warsaw
  — jedna definicja dnia dla wszystkich stron), `is_provisional`.

## 5. Plan etapami

### Etap 0 — przygotowanie i naprawy (niezależne od źródła)
0. Od razu: poprawka uprawnień funkcji `SECURITY DEFINER` (sekcja 2, „Pilne”).
1. Gałąź robocza od `claude/happy-bell-6no4qg` (produkcja), nie od `main`.
2. Decyzje biznesowe z sekcji 6.
3. Naprawy z sekcji 2: definicja revenue (statusy), dzień po Europe/Warsaw na stronach Przegląd / Revenue / Produkty,
   stronicowanie na stronie Produkty, `table_fabric_samples`, CZK dla mojepostel.cz.
4. Szybka wygrana na świeżość jeszcze przed panelem: cron `gdrive-sync` co godzinę w godzinach 5–10 UTC, uruchamiany
   tylko gdy `modifiedTime` pliku jest nowszy niż ostatni import, z ponowieniem po błędzie.
5. Kursy walut: `dim_exchange_rates` (EUR, CZK) zasilane codziennie z NBP — dziś kurs żyje tylko w `fact_orders.exchange_rate`,
   z awaryjnym 4,30 gdy NBP nie odpowie.

### Etap 1 — kontrakt danych w panelu (zmiany w projekcie panel-zamowien)
1. `erp-zamowienia`: zapisywać też `opcja` pozycji (kolumna `Pozycje zamówienia/Opcja` jest w tym samym CSV) i jednorazowo
   przeładować historię od 2025-01-01. Bez tego ZAM/ i marketplace’y nie będą miały atrybutów produktu.
2. `erp-zamowienia`: końcówka `-3` → rynek CZ, waluta CZK.
3. Włączyć codzienne liczenie `sklep_zgodnosc` (API ↔ ERP) — to warunek przełączenia.
4. Schemat `dash` + widoki + rola `dash_reader` (bez nazwisk, e-maili, telefonów, ulic).

### Etap 2 — tryb cienia w dashboardzie (min. 7 dni)
1. `panel-sync` zapisuje do osobnych tabel (`shadow_fact_orders`, `shadow_fact_order_items`).
2. Codzienny raport różnic vs obecne tabele: liczba zamówień i suma per sklep per dzień, statusy, zapłacone, top 20 modeli,
   tkanin, miast i producentów. Kryterium: 100% zamówień, różnica kwot ≤ 0,5% per sklep per dzień, wyjaśnione różnice kuponów.

### Etap 3 — przełączenie
1. `panel-sync` pisze do `fact_orders` / `fact_order_items` od daty przełączenia; wcześniejsze dane zostają.
2. `gdrive-sync` zdjęty z crona, zostaje jako ręczny fallback w ETL Admin.
3. Producent: `v_orders_with_producer` oparte o `orders.producer_code` (+ widok per pozycja), komunikat w UI, że ranking
   dostawców od teraz obejmuje wszystkich producentów.
4. Plan wycofania: włączenie crona `gdrive-sync` z powrotem (tabele mają ten sam kształt).

### Etap 4 — szybkość dashboardu
1. Funkcje SQL (RPC) dla grup KPI: jedno zapytanie z `GROUP BY` zamiast pobierania wszystkich wierszy do Node.
2. Indeks na `(order_day, source_shop)`; dzienny agregat odświeżany po każdym `panel-sync`.
3. Sprzątanie `raw_erp_orders`.

### Etap 5 — nowe KPI z panelu (opcjonalnie)
Marża I (koszt produkcji z `order_costs` — tylko dla adminów), rzeczywisty koszt dostawy, czas realizacji
(zamówienie → wysyłka), terminowość vs deadline, reklamacje na 100 zamówień per producent.

## 6. Decyzje do podjęcia

1. **Definicja przychodu**: „Revenue brutto” = tylko „Zamówienie sprzedaży” + „Zrealizowane” (oferty i anulowane osobno)?
   Rekomendacja: tak.
2. **Producent z panelu** zamiast z tagów ERP (liczby w rankingu się zmienią)? Rekomendacja: tak.
3. **Zamówienia z API, których ERP jeszcze nie ma**: pokazywać jako wstępne? Rekomendacja: tak, z oznaczeniem.
4. **Dane klienta**: tylko miasto / kod / kraj z API? Rekomendacja: tak, bez nazwisk, e-maili i telefonów.
5. **Dostęp do panelu**: rola tylko do odczytu na widokach `dash.*` (rekomendacja) czy klucz service_role.

## 7. Ryzyka

- API działa w trybie cienia od niedawna (komplet od 4.11). Mamy jednorazowe porównanie, nie historię zgodności.
- Statusy sprzedaży i część płatności nadal pochodzą z ERP. Dopóki nowy ERP nie przejmie statusów, eksport CSV jest potrzebny.
- `orders` w panelu to zlecenia produkcyjne, nie sprzedaż: jedno zamówienie może mieć kilka zleceń (różni producenci,
  przeróbki) — przypisanie przychodu do producenta trzeba robić per pozycja, nie per zamówienie.
