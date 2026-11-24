-- Panel administracyjny: flaga administratora na profilu.
-- Nadanie flagi pierwszym adminom wykonane ręcznie (profiles.is_admin = true
-- dla kont Dominika); kolejnych adminów mianuje się z panelu /studio/admin.

alter table public.profiles add column if not exists is_admin boolean not null default false;
