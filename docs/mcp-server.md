# Serwer MCP dash.mybed (`/api/mcp`)

Zdalny serwer MCP (Streamable HTTP, bezstanowy, odpowiedzi JSON), **tylko do odczytu**, dla skilla
`meta-ads-intel` i innych klientów Claude. Dane: `fact_daily_ad_performance`, `dim_creatives`,
`dim_campaigns`, `packshots`, `generations` i Storage w projekcie Supabase `sebckrbvoghfdrppdxyt`.

## Wdrożenie — kolejność ma znaczenie

1. **Migracja `supabase/migrations/025_mcp_server.sql` na `sebckrbvoghfdrppdxyt` PRZED deployem.**
   Kod `meta-ad-sync` zapisuje nowe kolumny `dim_creatives.thumb_storage_path` / `image_storage_path` /
   `thumb_stored_at` — bez migracji dzienny sync reklam przestanie działać.
2. Zmienne na Vercelu: `ANTHROPIC_API_KEY` (tagowanie AI), `CRON_SECRET` (już jest — crony).
3. Deploy. Nowe crony w `vercel.json`:
   - `/api/jobs/tag-creatives` co 10 min — 20 kreacji na przebieg (zaległe ~1 200 kreacji ≈ 10 h),
   - `/api/jobs/refresh-thumbnails` co 10 min — kopie miniatur do Storage, 25 na przebieg,
   - `/api/jobs/backfill-creative-ids` codziennie 07:30 UTC (po `meta-ad-sync` o 07:00).
4. Token: dash → **Dostęp MCP** (`/dashboard/mcp`) → „Wygeneruj”. Token widać tylko raz.

## Podłączenie

```bash
claude mcp add --transport http dash-mybed https://<domena-dash>/api/mcp --header "Authorization: Bearer dmcp_…"
```

Klient musi wysyłać nagłówek `Authorization: Bearer`. Konektory w claude.ai wymagają OAuth — tego serwer
jeszcze nie ma (do dołożenia, np. wzorem CFO Studio: OAuth 2.1 z dynamiczną rejestracją).

## Autoryzacja i zakres

- `mcp_tokens`: w bazie tylko SHA-256 tokenu; odwołanie i data ważności w panelu.
- Zakres sklepów: admin — wszystkie; viewer — `user_profiles.allowed_shops` (NULL = wszystkie). Ustawia admin
  w `/dashboard/mcp`. Migracja 025 zabiera użytkownikom prawo zapisu kolumn `role` i `allowed_shops`
  (wcześniej polityka RLS pozwalała każdemu podnieść sobie rolę kluczem anon).
- Sklep → konto Meta: `SHOP_TO_META_ACCOUNT` (to samo mapowanie co Agents MyBed). `mojepostel.cz` nie ma konta
  Meta — narzędzia zwracają pusty wynik z ostrzeżeniem.
- Każde wywołanie trafia do `mcp_audit` (narzędzie, argumenty, liczba wierszy, czas, błąd — bez wyników).

## Narzędzia

| Narzędzie | Co zwraca |
|---|---|
| `ads_performance` | metryki per kampania / zestaw / reklama / kreacja + zmiana vs poprzedni okres tej samej długości |
| `creative_fatigue` | reklamy: frequency > 3 i CTR −20% okno do okna, albo CPA +30% |
| `creatives_list` | kreacje z wynikami, tagami i stałym URL miniatury |
| `creative_detail` | pełne copy, obraz/wideo, analiza AI, dzienny szereg, reklamy z tą kreacją |
| `campaigns_list` | `dim_campaigns` + spend / ROAS 7 i 30 dni |
| `assets_search` | packshoty i sceny lifestyle z MyBed Studio, podpisane URL-e 24 h |
| `data_health` | ostatni dzień danych per konto, % bez creative_id, status tagów AI i miniatur, błędy ETL |

Definicje metryk są w `src/lib/mcp/metrics.ts` i w polu `definitions` każdej odpowiedzi. Kwoty w PLN,
domyślna atrybucja `7d_click`. `reach` to suma dziennych reach, więc `frequency` to średnia dzienna
częstotliwość — dolna granica częstotliwości w oknie.

## Znane ograniczenia

- Brak breakdownu per asset dla kreacji dynamicznych (`is_dynamic`) — wymaga osobnej tabeli i zapytań
  Meta z `body_asset` / `image_asset` / `video_asset`.
- `assets_search` nie ma jeszcze wideo (brak plików wideo w Storage) ani indeksu z Google Drive / Figmy.
- Etap 2 (Meta Ad Library, konkurencja) — niezaczęty; wymaga potwierdzenia tożsamości w Meta i aplikacji
  z dostępem do Ad Library API.
