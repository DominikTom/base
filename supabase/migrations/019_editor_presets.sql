-- Presety korekt obrazu (zakładka Edycja → Korekty): nazwane zestawy suwaków
-- zapisywane per użytkownik. Prywatne — bez udostępniania.

create table if not exists public.editor_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- {brightness, contrast, saturation, temperature, vignette, grayscale}
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_editor_presets_user on public.editor_presets (user_id);

alter table public.editor_presets enable row level security;

create policy "editor_presets_select_own" on public.editor_presets
  for select to authenticated using (user_id = (select auth.uid()));
create policy "editor_presets_insert_own" on public.editor_presets
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "editor_presets_update_own" on public.editor_presets
  for update to authenticated using (user_id = (select auth.uid()));
create policy "editor_presets_delete_own" on public.editor_presets
  for delete to authenticated using (user_id = (select auth.uid()));
