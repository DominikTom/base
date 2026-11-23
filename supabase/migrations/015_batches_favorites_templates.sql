-- ============================================================
-- 015: Serie generacji (warianty/batch), ulubione, rozdzielczość,
--      szablony ustawień kreatora
-- ============================================================

alter table public.generations
  add column if not exists batch_id uuid,
  add column if not exists is_favorite boolean not null default false,
  add column if not exists image_size text check (image_size in ('1K', '2K', '4K'));

create index if not exists idx_generations_batch
  on public.generations (batch_id) where batch_id is not null;
create index if not exists idx_generations_favorite
  on public.generations (is_favorite) where is_favorite;

create table if not exists public.creator_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  payload jsonb not null,
  shared boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.creator_templates enable row level security;

create policy "creator_templates_select" on public.creator_templates
  for select to authenticated using (user_id = (select auth.uid()) or shared);
create policy "creator_templates_insert" on public.creator_templates
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "creator_templates_update" on public.creator_templates
  for update to authenticated using (user_id = (select auth.uid()) or shared);
create policy "creator_templates_delete" on public.creator_templates
  for delete to authenticated using (user_id = (select auth.uid()) or shared);
