---
date: 2026-04-28
author: claude-flow swarm
session: session-1777369373915
branch: claude/check-repo-audit-report-XUNWV
scope: full repo (excluding node_modules, .next, .swarm, .claude/agents, .claude/skills)
files_reviewed: 28
key_files:
  - package.json
  - next.config.ts
  - tsconfig.json
  - vercel.json
  - src/middleware.ts
  - src/lib/supabase.ts
  - src/lib/google-drive.ts
  - src/lib/erp-parser.ts
  - src/app/auth/callback/route.ts
  - src/app/api/health/route.ts
  - src/app/api/etl/gdrive-sync/route.ts
  - src/app/api/etl/gdrive-request-sync/route.ts
  - src/app/api/etl/upload/route.ts
  - src/app/api/etl/backfill-eur/route.ts
  - src/app/api/etl/ga4-sync/route.ts
  - src/app/api/etl/meta-sync/route.ts
  - src/app/api/etl/meta-ad-sync/route.ts
  - src/app/api/etl/status/route.ts
  - src/app/api/jobs/refresh-thumbnails/route.ts
  - src/app/api/jobs/tag-creatives/route.ts
  - src/app/api/dashboard/overview/route.ts
  - supabase/migrations/002_user_profiles.sql
tags: [repo-audit, architecture, tech-debt, quick-wins, security]
---

# Repo Audit — 2026-04-28

## TL;DR

Internal Next.js 16 BI dashboard for MyBed Group with five Vercel Cron-driven ETL pipelines (Google Drive CSV, GA4, Meta Ads x2, plus AI creative tagging) writing to Supabase. The architecture is sound and the data layer is the right shape, but ETL endpoints have a **fail-open auth pattern** (public when `ETL_CRON_SECRET` is unset) and the admin Supabase client silently downgrades to the anon key — both production-impacting. Core quick wins: lock the ETL routes, fix the admin-client fallback, and add a CI workflow.

## Architektura

App Router project on Next.js `16.2.3` / React `19.2.4`, with Tailwind v4 and `recharts` + `react-grid-layout` for a draggable widget dashboard. Backend is Route Handlers in `src/app/api/`, talking to Supabase Postgres via two clients in `src/lib/supabase.ts` (anon for browser, service-role for server). Five Vercel Cron jobs declared in `vercel.json` drive ETL: `gdrive-sync` (CSV ERP exports → `fact_orders`/`fact_order_items` + aggregations), `ga4-sync`, `meta-sync` (campaign), `meta-ad-sync` (ad-level + creatives) and a poll mode for queued manual GDrive syncs. Auth uses Supabase Auth via `@supabase/ssr`, with `src/middleware.ts` protecting `/dashboard/*` and `/api/dashboard/*` and a `user_profiles` table (role-based, `viewer` default) hydrated in the OAuth callback. The dashboard surface is wide — 11 dashboard pages, ~10 API routes, ~4.7k LOC of app/lib code — but data flows in one consistent direction (Cron → ETL route → Supabase → dashboard route → React) with no in-app caching layer.

## Top 3 Technical Debt

### 1. Fail-open auth on `/api/etl/*` routes

- **Lokalizacja:** `src/middleware.ts:12` (allowlist) + every ETL route's `GET` (e.g. `src/app/api/etl/gdrive-sync/route.ts:32`, `ga4-sync/route.ts:17`, `meta-sync/route.ts:33`, `meta-ad-sync/route.ts:33`, `jobs/refresh-thumbnails/route.ts:27`, `jobs/tag-creatives/route.ts:23`). Plus `etl/gdrive-request-sync/route.ts`, `etl/upload/route.ts`, `etl/backfill-eur/route.ts` have **no auth at all**.
- **Problem:** middleware exempts the entire `/api/etl/` prefix from auth. The route-level guard reads `if (!isVercelCron && cronSecret && authHeader !== 'Bearer ${cronSecret}')` — the `&& cronSecret` short-circuit means **if the env var is unset (or empty), the check is skipped and the route is fully public**. Three routes (`gdrive-request-sync`, `upload`, `backfill-eur`) ship with no guard at all. `upload` accepts arbitrary JSON that gets `upsert`ed into `fact_orders`/`fact_order_items` with the service-role key. `backfill-eur` triggers a full-table rewrite of EUR rows. `gdrive-request-sync` lets anyone enqueue a manual GDrive pull that the cron poll then executes. Net effect: anyone on the public internet can corrupt the warehouse or trigger expensive operations.
- **Sugerowany fix:** (a) Centralise cron-auth in a `requireCronAuth(req)` helper in `src/lib/auth.ts` that **throws if `ETL_CRON_SECRET` is not configured** (no fail-open). (b) Apply it to every ETL/jobs handler, including the three currently-unguarded ones. (c) Either drop `/api/etl/` from the middleware public allowlist or keep it and rely solely on the route-level secret — but pick one model. (d) For `upload` (the batched browser path), require an authenticated session via `@supabase/ssr` instead of a shared secret.
- **Effort estimate:** 2-3h (1h helper + apply, 1h test, 0.5h docs).

### 2. `getSupabaseAdmin()` silently falls back to anon key

- **Lokalizacja:** `src/lib/supabase.ts:22-29`.
- **Problem:** the admin getter is `key = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ...`. If `SUPABASE_SERVICE_KEY` is absent in any env (preview/dev/branch deploy), the admin client is constructed with the **anon key**. Every server route that expects RLS bypass (all ETL routes, all dashboard API routes) will then hit RLS-restricted reads/writes and fail silently or partially. Worse, errors surface as Supabase RLS errors that look like data issues, not config issues. This couples failure modes that should be distinct.
- **Sugerowany fix:** `if (!key || key === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error('SUPABASE_SERVICE_KEY required for getSupabaseAdmin')`. Drop the anon fallback entirely. Bonus: in `/api/health`, separately probe the admin client and report which key class is in use.
- **Effort estimate:** 30min (5min code change + docs in `.env.example`, 25min smoke-test in preview).

### 3. ~500 lines of duplicated ETL aggregation logic

- **Lokalizacja:** `src/app/api/etl/gdrive-sync/route.ts` (`rebuildDailyRevenue` L203-253, `rebuildDimTables` L255-298, `fetchAllFrom` L301-316), `src/app/api/etl/upload/route.ts` (`rebuildDailyRevenue` L203-264, `rebuildDimProducts` L266-289, `rebuildDimFabrics` L291-313, `fetchAllFrom` L184-201), `src/app/api/etl/backfill-eur/route.ts` (inline EUR rebuild L62-122).
- **Problem:** the same daily-revenue rollup, products dim and fabrics dim are implemented three times with subtle drift — `gdrive-sync` rounds nothing, `backfill-eur` rounds to 2dp, `upload`'s `rebuildDimFabrics` is dead code (no longer called after the client started sending `batch_daily_revenue`). `fetchAllFrom` exists twice with different signatures (`(q) => q` callback vs. `extraFilters` object), each with its own `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. Any change to the revenue model has to be made in three places, and the dead `rebuildDailyRevenue/rebuildDimProducts/rebuildDimFabrics` in `upload/route.ts` will mislead future maintainers into thinking they're authoritative.
- **Sugerowany fix:** extract `src/lib/etl/aggregations.ts` with `rebuildDailyRevenue(db, range, opts)`, `rebuildDimProducts(db)`, `rebuildDimFabrics(db)` — strict types, no `any`. Extract `src/lib/etl/pagination.ts` with a single `paginatedFetch<T>(query, pageSize)`. Delete the dead helpers in `upload/route.ts`. Make `gdrive-sync` and `backfill-eur` call the shared rollup so the rounding rule stops drifting.
- **Effort estimate:** 4-6h (2h extract+type, 1h delete dead code, 1h smoke-test against staging Supabase, 1h PR review).

## Top 3 Quick Wins

### 1. Add a CI workflow (`.github/workflows/ci.yml`)

- **Opis:** there is no `.github/workflows/` directory; lint, typecheck and build only run in Vercel. Add a workflow that runs `npm ci && npm run lint && npx tsc --noEmit && npm run build` on every PR.
- **Expected impact:** catches breakage before Vercel deploy, gates merges on green, and gives the project a free baseline of regressions guards. Pairs naturally with future test additions — the test suite is currently empty.
- **Effort estimate:** 30min.

### 2. Strip details from `/api/health`

- **Opis:** `src/app/api/health/route.ts` is on the public middleware allowlist (intentional) but currently leaks Supabase `error.message`, `error.code`, `error.hint` and a per-env-var `set | MISSING` map. Reduce the public response to `{status: 'ok' | 'error'}` and gate the verbose payload behind `?diag=1` + `Authorization: Bearer ${HEALTH_DEBUG_SECRET}`.
- **Expected impact:** removes information disclosure (env-var presence + DB schema hints) without losing the diagnostic value for operators.
- **Effort estimate:** 15min.

### 3. Add Next.js security headers in `next.config.ts`

- **Opis:** `next.config.ts` is empty (just `/* config options here */`). Add an `async headers()` block returning `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a starter CSP scoped to the dashboard's actual origins (Supabase, NBP API, GA4 / Meta thumbnail CDNs).
- **Expected impact:** baseline browser hardening — kills clickjacking on the dashboard, blocks MIME sniffing, and prepares the ground for a real CSP. Also raises the project from a Mozilla Observatory F to ~B with no UX change.
- **Effort estimate:** 30min for headers; another 1-2h later if a strict CSP is desired.

## Załącznik: Lista przejrzanych plików

**Configuration (7):**
- `package.json`, `package-lock.json` (deps only inspected, not full audit)
- `next.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`
- `vercel.json`
- `.gitignore`
- `.claude/settings.json` (for hook structure)

**App / middleware (4):**
- `src/middleware.ts`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/login/page.tsx`

**Auth (1):**
- `src/app/auth/callback/route.ts`

**ETL routes (8):**
- `src/app/api/etl/gdrive-sync/route.ts`
- `src/app/api/etl/gdrive-request-sync/route.ts`
- `src/app/api/etl/upload/route.ts`
- `src/app/api/etl/backfill-eur/route.ts`
- `src/app/api/etl/ga4-sync/route.ts`
- `src/app/api/etl/meta-sync/route.ts`
- `src/app/api/etl/meta-ad-sync/route.ts` (top of file)
- `src/app/api/etl/status/route.ts`

**Other API (3):**
- `src/app/api/health/route.ts`
- `src/app/api/dashboard/overview/route.ts`
- `src/app/api/jobs/refresh-thumbnails/route.ts`
- `src/app/api/jobs/tag-creatives/route.ts`

**Lib (4 partial):**
- `src/lib/supabase.ts`
- `src/lib/google-drive.ts`
- `src/lib/erp-parser.ts` (header / first ~80 lines)
- `src/lib/dashboard-store.ts`

**DB (1):**
- `supabase/migrations/002_user_profiles.sql`

**Not reviewed (out of scope for this pass, candidates for follow-up):**
- `src/lib/meta-ads.ts`, `src/lib/ga4.ts`, `src/lib/creative-tagger.ts`, `src/lib/nbp.ts`, `src/lib/currency.ts`, `src/lib/dashboard-context.tsx`, `src/lib/widget-definitions.ts`, `src/lib/user-profile.ts`, `src/lib/utils.ts`
- `src/components/**/*` (10 files)
- `src/app/dashboard/**/*` (11 pages)
- Other `src/app/api/dashboard/*` routes (8 of 9)
- `supabase/migrations/001`, `003`, `004`
- `src/types/database.ts`
- `scripts/auto-commit-push.sh`
