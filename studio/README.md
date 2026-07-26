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

| Model | ID API | Kiedy używać |
|---|---|---|
| Nano Banana Pro (domyślny) | `gemini-3-pro-image` | finalne wizualizacje, najlepszy fotorealizm tkanin |
| Nano Banana 2 | `gemini-3.1-flash-image` | szkice i szybkie iteracje |
| GPT Image 2 | `gpt-image-2` | chirurgiczne poprawki pędzlem (natywna maska) |

Identyfikatory można nadpisać env varami `GEMINI_PRO_IMAGE_MODEL`,
`GEMINI_FLASH_IMAGE_MODEL`, `OPENAI_IMAGE_MODEL` (gdy dostawca zmieni nazwy).
Warstwa abstrakcji: `src/lib/studio/providers/` (interfejs `ImageProvider` —
dodanie kolejnego modelu, np. FLUX Fill, to jedna klasa + wpis w rejestrze).

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
