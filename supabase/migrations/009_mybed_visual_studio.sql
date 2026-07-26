-- ============================================================
-- 009: MyBed Visual Studio — schema, RLS, storage, seed pokoi
-- ============================================================

-- ---------- Tabele ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'editor',
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_prompt text not null,
  sort_order int not null default 0,
  icon text,
  created_at timestamptz not null default now()
);

create table if not exists public.packshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  original_filename text,
  width int,
  height int,
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.inspiration_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  cover_image_id uuid,
  room_id uuid references public.rooms (id) on delete set null,
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.inspiration_images (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.inspiration_sets (id) on delete cascade,
  storage_path text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

alter table public.inspiration_sets
  add constraint inspiration_sets_cover_image_fk
  foreign key (cover_image_id) references public.inspiration_images (id) on delete set null;

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  packshot_id uuid references public.packshots (id) on delete set null,
  parent_generation_id uuid references public.generations (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  style_text text,
  inspiration_set_id uuid references public.inspiration_sets (id) on delete set null,
  inspiration_strength int check (inspiration_strength between 1 and 5),
  manual_notes text,
  model text not null,
  full_prompt_sent text,
  mask_storage_path text,
  edit_instruction text,
  storage_path text,
  width int,
  height int,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  error_message text,
  duration_ms int,
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_packshots_user on public.packshots (user_id) where deleted_at is null;
create index if not exists idx_generations_user on public.generations (user_id);
create index if not exists idx_generations_status on public.generations (status) where deleted_at is null;
create index if not exists idx_generations_packshot on public.generations (packshot_id);
create index if not exists idx_generations_parent on public.generations (parent_generation_id);
create index if not exists idx_inspiration_images_set on public.inspiration_images (set_id);

-- ---------- Trigger: profil przy rejestracji ----------

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- ---------- RLS ----------
-- Małe narzędzie zespołowe: użytkownik widzi swoje dane + oznaczone shared=true
-- (domyślnie wszystko shared).

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.packshots enable row level security;
alter table public.inspiration_sets enable row level security;
alter table public.inspiration_images enable row level security;
alter table public.generations enable row level security;

create policy "profiles_select" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = (select auth.uid()));

create policy "rooms_select" on public.rooms
  for select to authenticated using (true);
create policy "rooms_insert" on public.rooms
  for insert to authenticated with check (true);
create policy "rooms_update" on public.rooms
  for update to authenticated using (true);
create policy "rooms_delete" on public.rooms
  for delete to authenticated using (true);

create policy "packshots_select" on public.packshots
  for select to authenticated using (user_id = (select auth.uid()) or shared);
create policy "packshots_insert" on public.packshots
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "packshots_update" on public.packshots
  for update to authenticated using (user_id = (select auth.uid()) or shared);
create policy "packshots_delete" on public.packshots
  for delete to authenticated using (user_id = (select auth.uid()) or shared);

create policy "inspiration_sets_select" on public.inspiration_sets
  for select to authenticated using (user_id = (select auth.uid()) or shared);
create policy "inspiration_sets_insert" on public.inspiration_sets
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "inspiration_sets_update" on public.inspiration_sets
  for update to authenticated using (user_id = (select auth.uid()) or shared);
create policy "inspiration_sets_delete" on public.inspiration_sets
  for delete to authenticated using (user_id = (select auth.uid()) or shared);

create policy "inspiration_images_select" on public.inspiration_images
  for select to authenticated using (
    exists (
      select 1 from public.inspiration_sets s
      where s.id = set_id and (s.user_id = (select auth.uid()) or s.shared)
    )
  );
create policy "inspiration_images_insert" on public.inspiration_images
  for insert to authenticated with check (
    exists (
      select 1 from public.inspiration_sets s
      where s.id = set_id and (s.user_id = (select auth.uid()) or s.shared)
    )
  );
create policy "inspiration_images_delete" on public.inspiration_images
  for delete to authenticated using (
    exists (
      select 1 from public.inspiration_sets s
      where s.id = set_id and (s.user_id = (select auth.uid()) or s.shared)
    )
  );

create policy "generations_select" on public.generations
  for select to authenticated using (user_id = (select auth.uid()) or shared);
create policy "generations_insert" on public.generations
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "generations_update" on public.generations
  for update to authenticated using (user_id = (select auth.uid()) or shared);
create policy "generations_delete" on public.generations
  for delete to authenticated using (user_id = (select auth.uid()) or shared);

-- ---------- Storage: prywatne buckety ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('packshots', 'packshots', false, 20971520, array['image/png', 'image/jpeg', 'image/webp']),
  ('inspirations', 'inspirations', false, 20971520, array['image/png', 'image/jpeg', 'image/webp']),
  ('generations', 'generations', false, 52428800, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "studio_buckets_select" on storage.objects
  for select to authenticated
  using (bucket_id in ('packshots', 'inspirations', 'generations'));
create policy "studio_buckets_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('packshots', 'inspirations', 'generations'));
create policy "studio_buckets_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('packshots', 'inspirations', 'generations'));
create policy "studio_buckets_delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('packshots', 'inspirations', 'generations'));

-- ---------- Seed: pokoje ----------
-- base_prompt po angielsku (trafia do modelu), name po polsku (UI).

insert into public.rooms (name, base_prompt, sort_order, icon)
select v.name, v.base_prompt, v.sort_order, v.icon
from (values
  ('Sypialnia',
   'A serene, elegant master bedroom interior. The bed is the hero of the scene, placed naturally against a tasteful feature wall. Soft layered bedding, bedside tables with warm lamps, a large window with gentle daylight, a rug under the bed, calm and restful atmosphere.',
   10, 'bed-double'),
  ('Salon',
   'A stylish, comfortable living room interior. The furniture piece is presented naturally within a lounge arrangement: coffee table, floor lamp, plants, bookshelf or media wall in the background, large windows with natural light, cozy yet refined atmosphere.',
   20, 'sofa'),
  ('Pokój dziecięcy',
   'A bright, playful children''s room. The furniture piece fits naturally among soft toys, a small shelf with books, playful wall decor, pastel accents, a soft rug, safe and warm atmosphere with plenty of daylight.',
   30, 'baby'),
  ('Pokój młodzieżowy',
   'A modern teenager''s room. The furniture piece is placed among a desk with a chair, posters or wall art, shelving with books and gadgets, a floor lamp, expressive but tasteful colors, energetic yet cozy atmosphere.',
   40, 'gamepad-2'),
  ('Gabinet / biuro domowe',
   'An elegant home office. The furniture piece fits into a focused workspace: a desk with an ergonomic chair, bookshelves, a task lamp, subtle decor, muted professional palette, calm daylight from a side window.',
   50, 'briefcase-business'),
  ('Garderoba',
   'A refined walk-in wardrobe / dressing room. The furniture piece is presented among open wardrobes with neatly arranged clothing, a full-length mirror, soft pouf, warm accent lighting, orderly premium boutique atmosphere.',
   60, 'shirt'),
  ('Pokój gościnny',
   'A welcoming guest bedroom. The furniture piece is arranged in a neutral, hotel-like setting: crisp bedding, a small bench or luggage rack, understated wall art, soft curtains, warm inviting light, uncluttered space.',
   70, 'door-open'),
  ('Studio / loft',
   'A spacious industrial loft studio. The furniture piece stands in an open-plan space with exposed brick or concrete, tall factory windows, black metal accents, wooden floor, dramatic natural light, contemporary urban atmosphere.',
   80, 'warehouse')
) as v(name, base_prompt, sort_order, icon)
where not exists (select 1 from public.rooms limit 1);
