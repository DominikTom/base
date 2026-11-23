# MyBed Visual Studio

Wewnętrzne narzędzie do generowania i edycji wizualizacji produktowych
(packshot → fotorealistyczna aranżacja wnętrza) dla działu content marketingu.
Sekcje: Nowa wizualizacja, Biblioteka, Inspiracje, Kosz.

## Deploy (osobny projekt Vercel)

1. Vercel → **Add New… → Project** → Import repo `DominikTom/base`.
2. **Root Directory: `studio`** (Edit obok nazwy repo przy imporcie).
3. Framework: Next.js (wykryje się sam). Deploy.
4. Settings → Environment Variables — dodaj:
   - `GEMINI_API_KEY` — klucz Gemini API (Nano Banana Pro / Nano Banana 2),
   - `OPENAI_API_KEY` — klucz OpenAI (GPT Image 2),
   - `SUPABASE_SERVICE_KEY` — *(opcjonalnie)* service role key z Supabase
     (Settings → API) — potrzebny tylko do automatycznego czyszczenia kosza
     przez cron; bez niego ręczne usuwanie z kosza działa normalnie,
   - `CRON_SECRET` — *(opcjonalnie)* losowy sekret zabezpieczający endpoint crona.
5. Po dodaniu zmiennych: Deployments → ⋯ → Redeploy.

URL i klucz anon Supabase mają wbudowane fallbacki w `next.config.ts`
(klucz anon jest z założenia publiczny — dostęp do danych chroni RLS),
więc aplikacja działa od razu po imporcie. Zmienne `NEXT_PUBLIC_SUPABASE_URL`
i `NEXT_PUBLIC_SUPABASE_ANON_KEY` ustawione w Vercel mają pierwszeństwo.

## Modele generacji

Rejestr modeli jest data-driven: `src/lib/studio/models.ts` (dodanie modelu =
jeden wpis; identyfikator API nadpisywalny env varem z pola `envVar`).
Stan na XI 2026:

| Model | ID API | Kiedy używać |
|---|---|---|
| Nano Banana Pro (domyślny do generacji) | `gemini-3-pro-image` | finalne wizualizacje, 2K/4K |
| Nano Banana 2.1 | `gemini-nano-banana-2.1` | szybkie, dobre iteracje |
| Nano Banana 2 | `gemini-3.1-flash-image` | najtańsze szkice |
| GPT Image 2.6 Sunburst (domyślny do edycji) | `gpt-image-2.6-sunburst` | precyzyjne poprawki pędzlem (maska) |
| GPT Image 2.6 Flare | `gpt-image-2.6-flare` | szybka generacja OpenAI |
| GPT Image 2.5 Sunburst / Flare | `gpt-image-2.5-…` | starsze odpowiedniki 2.6 |
| GPT Image 2 | `gpt-image-2` | legacy |

## Wiele packshotów w jednej wizualizacji

Do wizualizacji można dodać **do 5 packshotów**. Pierwszy wybrany automatycznie
zostaje **głównym** produktem (bohaterem sceny), kolejne — **dodatkami**;
rolę zmienia się kliknięciem etykiety na miniaturze. Dozwolone jest wiele
głównych (np. kolekcja mebli twardych: 3 komody + RTV) — prompt instruuje
model, żeby potraktował je jako spójną kolekcję, a wszystkie produkty
pozostały wiernie odwzorowane. Powiązania: tabela `generation_packshots`
(migracja `010_generation_packshots.sql`).

## Architektura

- Auth: Supabase (e-mail + hasło), wspólny projekt z dashboardem
  (`sebckrbvoghfdrppdxyt`). Rejestracja wyłączona — konta zakłada admin
  w panelu Supabase. TODO Google OAuth: patrz `src/app/login/page.tsx`.
- Storage: prywatne buckety `packshots`, `inspirations`, `generations`;
  pliki serwowane przez proxy `GET /api/studio/file` (sesja + RLS).
- Generacje: asynchroniczne (`after()`), status pollowany w UI;
  `POST /api/studio/generations`, edycje pędzlem: `POST /api/studio/edits`.
- Kosz: soft delete, auto-czyszczenie po 30 dniach
  (cron `GET /api/studio/trash/purge` codziennie 03:30 UTC).
- Diagnostyka konfiguracji: `GET /api/studio/health` (flagi obecności env vars).

## Dev lokalny

```bash
cd studio && npm install && npm run dev
```
