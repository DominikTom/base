# Data Hub MyBed — REST API i serwer MCP

Dane MyBed Group **tylko do odczytu**, z jednego jądra wystawionego dwoma drzwiami:

- **REST** `GET https://dash.mybed.pl/api/v1/<zasób>` — dla aplikacji i automatyzacji (Apps Script, n8n, Looker, ERP).
  Specyfikacja OpenAPI 3.1: `https://dash.mybed.pl/api/v1/openapi.json` (publiczna, bez danych).
- **MCP** `https://dash.mybed.pl/api/mcp` (Streamable HTTP) — dla Claude.

Każda zdolność jest zdefiniowana raz w `src/lib/hub/capabilities/*.ts` (schemat wejścia zod + opis + `run`).
Rejestr: `src/lib/hub/registry.ts`. Walidacja, zakres sklepów i audyt: `executeCapability` w `src/lib/hub/core.ts`.
Nowa zdolność = nowy obiekt `defineCapability` w rejestrze — automatycznie pojawia się w REST, OpenAPI i MCP.

## Zasoby

| REST (`/api/v1/…`) | MCP | Co zwraca |
|---|---|---|
| `sales/summary` | `sales_summary` | zamówienia, przychód brutto PLN, AOV, płatności, oferty, anulowane; łącznie / kanał / dzień / tydzień / miesiąc; zmiana vs poprzedni okres |
| `products/ranking` | `products_ranking` | modele, kategorie, tkaniny, kolekcje, rozmiary, materace, wezgłowia, stelaże w sprzedanych zamówieniach |
| `traffic/summary` | `traffic_summary` | sesje, użytkownicy, transakcje, konwersja, przychód GA4 i koszt Google Ads (PLN) |
| `traffic/sources` | `traffic_sources` | źródło / medium z sesjami, transakcjami, konwersją, przychodem |
| `showrooms/summary` | `showrooms_summary` | sprzedaż showroomów (arkusze), zaksięgowane, wejścia Sensmax, konwersja |
| `ads/performance` | `ads_performance` | metryki Meta per kampania / zestaw / reklama / kreacja + zmiana vs poprzedni okres |
| `ads/fatigue` | `creative_fatigue` | zmęczenie kreacji: frequency > 3 i CTR −20%, albo CPA +30% |
| `creatives` | `creatives_list` | kreacje z wynikami, tagami AI i stałym URL miniatury |
| `creatives/{creative_id}` | `creative_detail` | pełne copy, obraz/wideo, analiza AI, dzienny szereg, reklamy |
| `campaigns` | `campaigns_list` | kampanie Meta + spend / ROAS 7 i 30 dni |
| `assets` | `assets_search` | packshoty i sceny lifestyle z MyBed Studio (podpisane URL-e 24 h) |
| `health` | `data_health` | świeżość wszystkich źródeł, braki creative_id, status tagów AI i miniatur, błędy ETL |

`GET /api/v1` zwraca listę zasobów i zakres sklepów tokenu. Parametry: daty `YYYY-MM-DD`, listy po przecinku,
booleany `true/false`. Kody: 400 (parametry), 401 (token), 403 (zakres), 404, 405 (tylko GET).

```bash
curl -H "Authorization: Bearer dmcp_…" "https://dash.mybed.pl/api/v1/sales/summary?date_from=2026-11-01&date_to=2026-11-18&group_by=shop"
```

```bash
claude mcp add --transport http dash-mybed https://dash.mybed.pl/api/mcp --header "Authorization: Bearer dmcp_…"
```

## Definicje (wspólne dla REST i MCP)

- **Sprzedaż** = zamówienia w statusach „Zamówienie sprzedaży” i „Zrealizowane”. Oferty i anulowane są osobno.
  (Dzisiejsze widgety dashboardu liczą wszystkie statusy — patrz audyt `docs/audit/2026-11-panel-zamowien-plan.md`.)
- **Dzień** = data zamówienia w strefie Europe/Warsaw.
- **Przychód PLN** = pole „Suma” z ERP (brutto, z dostawą); EUR i CZK przeliczone kursem NBP z dnia zamówienia.
- **Kanały sprzedaży** i dostęp: mybed.pl (+ allegro.pl, zam), mybed.de (+ amazon.de, kaufland.de), mojepostel.cz,
  mittohome.pl, nomosleep.pl. Zamówienia ZAM/ domyślnie pominięte (`include_internal=true` je dołącza);
  sprzedaż showroomów pochodzi z arkuszy (`showrooms/summary`).
- **Reklamy**: PLN, domyślna atrybucja `7d_click`, `frequency` = średnia dzienna (dolna granica w oknie).
- **Showroomy** wymagają dostępu do mybed.pl; konwersja tylko dla showroomów z licznikami Sensmax.

## Autoryzacja i zakres

- Token `dmcp_…` z dash → **Dostęp API i MCP** (`/dashboard/mcp`); w bazie tylko SHA-256. Jeden token działa w REST i MCP.
- Zakres sklepów: admin — wszystkie; viewer — `user_profiles.allowed_shops` (NULL = wszystkie), ustawia admin na tej samej stronie.
- Każde wywołanie trafia do `mcp_audit` (`tool` z prefiksem `rest:` dla REST; argumenty, wiersze, czas, błąd — bez wyników).
- Konektory w claude.ai wymagają OAuth — tego jeszcze nie ma (Claude Code i klienci z nagłówkiem Bearer działają).

## Wdrożenie

1. Migracje na `sebckrbvoghfdrppdxyt`: `025_mcp_server.sql` (zastosowana 19.11) i
   **`026_data_hub_functions.sql`** — funkcje SQL dla sprzedaży, produktów i źródeł ruchu. Bez 026 te trzy zasoby
   zwracają błąd z prośbą o migrację; reszta działa.
2. Crony (`vercel.json`): tagowanie AI i kopie miniatur co 10 min, backfill creative_id codziennie 07:30 UTC.
3. Parser ERP: zamówienia `Shoper…-3` = mojepostel.cz w CZK (od najbliższego importu ERP; wcześniej `shoper_unknown`).

## Znane ograniczenia

- Sprzedaż pochodzi z eksportu IdeaERP (raz dziennie) — dzisiejsze zamówienia mogą jeszcze nie być widoczne.
  Plan przejścia na panel-zamowien: `docs/audit/2026-11-panel-zamowien-plan.md`.
- Brak breakdownu per asset dla kreacji dynamicznych, wideo w `assets`, etapu Biblioteki reklam Meta.
