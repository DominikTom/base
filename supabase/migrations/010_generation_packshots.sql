-- ============================================================
-- 010: Wiele packshotów na wizualizację (do 5, role główny/dodatek)
-- ============================================================

create table if not exists public.generation_packshots (
  generation_id uuid not null references public.generations (id) on delete cascade,
  packshot_id uuid not null references public.packshots (id) on delete cascade,
  role text not null default 'main' check (role in ('main', 'addition')),
  sort_order int not null default 0,
  primary key (generation_id, packshot_id)
);

create index if not exists idx_generation_packshots_packshot
  on public.generation_packshots (packshot_id);

alter table public.generation_packshots enable row level security;

-- Dostęp przez własność/udostępnienie generacji-rodzica.
create policy "generation_packshots_select" on public.generation_packshots
  for select to authenticated using (
    exists (
      select 1 from public.generations g
      where g.id = generation_id and (g.user_id = (select auth.uid()) or g.shared)
    )
  );
create policy "generation_packshots_insert" on public.generation_packshots
  for insert to authenticated with check (
    exists (
      select 1 from public.generations g
      where g.id = generation_id and g.user_id = (select auth.uid())
    )
  );
create policy "generation_packshots_delete" on public.generation_packshots
  for delete to authenticated using (
    exists (
      select 1 from public.generations g
      where g.id = generation_id and (g.user_id = (select auth.uid()) or g.shared)
    )
  );

-- Backfill: istniejące generacje z pojedynczym packshotem → wiersz "main".
insert into public.generation_packshots (generation_id, packshot_id, role, sort_order)
select g.id, g.packshot_id, 'main', 0
from public.generations g
where g.packshot_id is not null
on conflict do nothing;
