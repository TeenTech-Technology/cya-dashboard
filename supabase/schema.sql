-- =========================================================
-- CYA (Chingola Youth Association) events database
-- Safe to run more than once. Run in the Supabase SQL editor
-- or via scripts/setup.sh.
-- =========================================================

-- ---------- Tables ----------
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 160),
  event_date    date,
  date_tbc      boolean not null default false,
  venue         text,
  description   text,
  status        text not null default 'upcoming' check (status in ('upcoming','past')),
  poster_url    text,
  register_url  text check (register_url is null or register_url ~* '^https?://'),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- Is the signed-in user an admin? (security definer so it can read admins under RLS)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- Row Level Security ----------
alter table public.events enable row level security;
alter table public.admins enable row level security;

drop policy if exists "events public read"   on public.events;
drop policy if exists "events admin insert"  on public.events;
drop policy if exists "events admin update"  on public.events;
drop policy if exists "events admin delete"  on public.events;
create policy "events public read"  on public.events for select using (true);
create policy "events admin insert" on public.events for insert to authenticated with check (public.is_admin());
create policy "events admin update" on public.events for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "events admin delete" on public.events for delete to authenticated using (public.is_admin());

-- Admins can see the admin list (only their own context); nobody writes it from the browser.
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select to authenticated using (user_id = auth.uid());

grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant select on public.admins to authenticated;

-- ---------- Storage: public 'posters' bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "posters public read"  on storage.objects;
drop policy if exists "posters admin insert" on storage.objects;
drop policy if exists "posters admin update" on storage.objects;
drop policy if exists "posters admin delete" on storage.objects;
create policy "posters public read"  on storage.objects for select using (bucket_id = 'posters');
create policy "posters admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'posters' and public.is_admin());
create policy "posters admin update" on storage.objects for update to authenticated using (bucket_id = 'posters' and public.is_admin());
create policy "posters admin delete" on storage.objects for delete to authenticated using (bucket_id = 'posters' and public.is_admin());

-- ---------- Seed: exactly the events on cya-website/events.html ----------
-- Only inserted when the table is empty, so re-running never duplicates.
insert into public.events (title, event_date, date_tbc, venue, description, status, poster_url, register_url, sort_order)
select * from (values
  ('Chingola Youth Indaba (next edition)', null::date, true, null::text,
   'Our annual gathering for young people from all walks of life.', 'upcoming', null::text,
   'https://teentech-technology.github.io/cya-website/register.html', 1),
  ('Chingola Youth Parliament', null::date, true, null::text,
   'A ground-breaking platform for youth civic engagement.', 'upcoming', null::text, null::text, 2),
  ('CYA Mentorship Academy', null::date, true, null::text,
   'Launch of the CYA Mentorship Academy in Chingola.', 'upcoming', null::text, null::text, 3),
  ('Chingola Youth Indaba 2025', null::date, false, null::text,
   'The 2025 edition attracted over 200 youths from all walks of life, and the Indaba was declared an annual event.',
   'past', 'https://teentech-technology.github.io/cya-website/img/indaba-poster.webp', null::text, 4)
) as v(title, event_date, date_tbc, venue, description, status, poster_url, register_url, sort_order)
where not exists (select 1 from public.events);
