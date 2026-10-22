-- =========================================================
-- CYA migration 002: volunteers, partners, seat reservations
-- Safe to run more than once. Paste into Supabase > SQL Editor > Run.
-- Requires schema.sql (events, admins, is_admin()) to be applied first.
-- =========================================================

-- ---------- Volunteers ----------
create table if not exists public.volunteers (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null check (char_length(full_name) between 1 and 120),
  phone         text not null check (char_length(phone) between 5 and 40),
  email         text check (email is null or (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  area          text not null check (char_length(area) between 1 and 120),
  age_range     text check (age_range is null or char_length(age_range) <= 20),
  skills        text not null check (char_length(skills) between 1 and 1000),
  availability  text not null check (char_length(availability) between 1 and 300),
  message       text check (message is null or char_length(message) <= 2000),
  consent       boolean not null check (consent),
  status        text not null default 'new' check (status in ('new','contacted','active','declined')),
  created_at    timestamptz not null default now()
);

-- ---------- Partners ----------
create table if not exists public.partners (
  id               uuid primary key default gen_random_uuid(),
  organisation     text not null check (char_length(organisation) between 1 and 160),
  contact_person   text not null check (char_length(contact_person) between 1 and 120),
  phone            text not null check (char_length(phone) between 5 and 40),
  email            text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  partnership_type text not null check (partnership_type in ('sponsor','venue','in-kind','programme','other')),
  message          text check (message is null or char_length(message) <= 2000),
  status           text not null default 'new' check (status in ('new','contacted','active','declined')),
  created_at       timestamptz not null default now()
);

-- ---------- Events: optional capacity ----------
alter table public.events add column if not exists capacity int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_capacity_check') then
    alter table public.events add constraint events_capacity_check check (capacity is null or capacity between 1 and 100000);
  end if;
end $$;

-- ---------- Reservations (tickets) ----------
create table if not exists public.reservations (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  ticket_code    text not null unique,
  full_name      text not null check (char_length(full_name) between 1 and 120),
  phone          text not null check (char_length(phone) between 5 and 40),
  email          text check (email is null or (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  seats          int  not null check (seats between 1 and 5),
  checked_in     boolean not null default false,
  checked_in_at  timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists reservations_event_idx on public.reservations(event_id);

-- ---------- Row Level Security ----------
alter table public.volunteers   enable row level security;
alter table public.partners     enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "volunteers public insert" on public.volunteers;
drop policy if exists "volunteers admin select" on public.volunteers;
drop policy if exists "volunteers admin update" on public.volunteers;
drop policy if exists "volunteers admin delete" on public.volunteers;
create policy "volunteers public insert" on public.volunteers for insert to anon, authenticated with check (status = 'new');
create policy "volunteers admin select" on public.volunteers for select to authenticated using (public.is_admin());
create policy "volunteers admin update" on public.volunteers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "volunteers admin delete" on public.volunteers for delete to authenticated using (public.is_admin());

drop policy if exists "partners public insert" on public.partners;
drop policy if exists "partners admin select" on public.partners;
drop policy if exists "partners admin update" on public.partners;
drop policy if exists "partners admin delete" on public.partners;
create policy "partners public insert" on public.partners for insert to anon, authenticated with check (status = 'new');
create policy "partners admin select" on public.partners for select to authenticated using (public.is_admin());
create policy "partners admin update" on public.partners for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "partners admin delete" on public.partners for delete to authenticated using (public.is_admin());

-- Reservations: no public policies at all. The public books only through reserve_seat().
drop policy if exists "reservations admin select" on public.reservations;
drop policy if exists "reservations admin update" on public.reservations;
drop policy if exists "reservations admin delete" on public.reservations;
create policy "reservations admin select" on public.reservations for select to authenticated using (public.is_admin());
create policy "reservations admin update" on public.reservations for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "reservations admin delete" on public.reservations for delete to authenticated using (public.is_admin());

revoke all on public.volunteers, public.partners, public.reservations from anon, authenticated;
grant insert (full_name, phone, email, area, age_range, skills, availability, message, consent) on public.volunteers to anon, authenticated;
grant insert (organisation, contact_person, phone, email, partnership_type, message) on public.partners to anon, authenticated;
grant select, update, delete on public.volunteers, public.partners, public.reservations to authenticated;

-- ---------- reserve_seat(): the only way the public can book ----------
create or replace function public.reserve_seat(
  p_event_id uuid, p_name text, p_phone text, p_email text, p_seats int
) returns json
language plpgsql security definer set search_path = public as $$
declare
  ev public.events%rowtype;
  taken int;
  mine int;
  code text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  p_name := btrim(coalesce(p_name, '')); p_phone := btrim(coalesce(p_phone, ''));
  p_email := nullif(btrim(coalesce(p_email, '')), '');
  if char_length(p_name) not between 1 and 120 then raise exception 'Please enter your name.' using errcode = 'P0001'; end if;
  if char_length(p_phone) not between 5 and 40 then raise exception 'Please enter a phone number.' using errcode = 'P0001'; end if;
  if p_seats is null or p_seats not between 1 and 5 then raise exception 'You can reserve between 1 and 5 seats.' using errcode = 'P0001'; end if;

  select * into ev from public.events where id = p_event_id for update;
  if not found then raise exception 'We could not find that event.' using errcode = 'P0001'; end if;
  if ev.status <> 'upcoming' or (ev.event_date is not null and ev.event_date < current_date) then
    raise exception 'Reservations for this event are closed.' using errcode = 'P0001';
  end if;

  select coalesce(sum(seats), 0) into taken from public.reservations where event_id = p_event_id;
  if ev.capacity is not null and taken + p_seats > ev.capacity then
    raise exception 'Sorry, only % seat(s) are left for this event.', greatest(ev.capacity - taken, 0) using errcode = 'P0001';
  end if;
  select coalesce(sum(seats), 0) into mine from public.reservations
   where event_id = p_event_id and regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g');
  if mine + p_seats > 5 then
    raise exception 'This phone number already has seats reserved for this event (up to 5 per person).' using errcode = 'P0001';
  end if;

  loop
    code := 'CYA-';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.reservations where ticket_code = code);
  end loop;

  insert into public.reservations (event_id, ticket_code, full_name, phone, email, seats)
  values (p_event_id, code, p_name, p_phone, p_email, p_seats);

  return json_build_object('code', code, 'seats', p_seats,
    'seats_left', case when ev.capacity is null then null else ev.capacity - taken - p_seats end);
end $$;
revoke all on function public.reserve_seat(uuid, text, text, text, int) from public;
grant execute on function public.reserve_seat(uuid, text, text, text, int) to anon, authenticated;

-- ---------- Public seat counts (numbers only, no personal details) ----------
create or replace function public.event_seats()
returns table (event_id uuid, capacity int, seats_taken int)
language sql stable security definer set search_path = public as $$
  select e.id, e.capacity, coalesce(sum(r.seats), 0)::int
  from public.events e left join public.reservations r on r.event_id = e.id
  group by e.id, e.capacity;
$$;
revoke all on function public.event_seats() from public;
grant execute on function public.event_seats() to anon, authenticated;


-- =========================================================
-- Part 2: newsletter, gallery, feedback, visitor stats
-- =========================================================

-- ---------- Newsletter subscribers ----------
create table if not exists public.subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name        text check (name is null or char_length(name) <= 120),
  created_at  timestamptz not null default now()
);
create unique index if not exists subscribers_email_uq on public.subscribers (lower(email));
alter table public.subscribers enable row level security;
drop policy if exists "subscribers admin select" on public.subscribers;
drop policy if exists "subscribers admin delete" on public.subscribers;
create policy "subscribers admin select" on public.subscribers for select to authenticated using (public.is_admin());
create policy "subscribers admin delete" on public.subscribers for delete to authenticated using (public.is_admin());
revoke all on public.subscribers from anon, authenticated;
grant select, delete on public.subscribers to authenticated;

-- Public sign-up goes through this function. It always answers the same way,
-- so nobody can find out whether an email is already on the list.
create or replace function public.subscribe(p_email text, p_name text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  p_email := lower(btrim(coalesce(p_email, '')));
  p_name := nullif(btrim(coalesce(p_name, '')), '');
  if char_length(p_email) > 200 or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.' using errcode = 'P0001';
  end if;
  if p_name is not null and char_length(p_name) > 120 then p_name := left(p_name, 120); end if;
  insert into public.subscribers (email, name) values (p_email, p_name) on conflict do nothing;
  return json_build_object('ok', true);
end $$;
revoke all on function public.subscribe(text, text) from public;
grant execute on function public.subscribe(text, text) to anon, authenticated;

-- ---------- Photo gallery ----------
create table if not exists public.gallery (
  id          uuid primary key default gen_random_uuid(),
  image_url   text not null check (image_url ~* '^https://'),
  path        text,
  caption     text check (caption is null or char_length(caption) <= 300),
  event_id    uuid references public.events(id) on delete set null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.gallery enable row level security;
drop policy if exists "gallery public read" on public.gallery;
drop policy if exists "gallery admin insert" on public.gallery;
drop policy if exists "gallery admin update" on public.gallery;
drop policy if exists "gallery admin delete" on public.gallery;
create policy "gallery public read"  on public.gallery for select using (true);
create policy "gallery admin insert" on public.gallery for insert to authenticated with check (public.is_admin());
create policy "gallery admin update" on public.gallery for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "gallery admin delete" on public.gallery for delete to authenticated using (public.is_admin());
grant select on public.gallery to anon, authenticated;
grant insert, update, delete on public.gallery to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "gallery files public read"  on storage.objects;
drop policy if exists "gallery files admin insert" on storage.objects;
drop policy if exists "gallery files admin update" on storage.objects;
drop policy if exists "gallery files admin delete" on storage.objects;
create policy "gallery files public read"  on storage.objects for select using (bucket_id = 'gallery');
create policy "gallery files admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'gallery' and public.is_admin());
create policy "gallery files admin update" on storage.objects for update to authenticated using (bucket_id = 'gallery' and public.is_admin());
create policy "gallery files admin delete" on storage.objects for delete to authenticated using (bucket_id = 'gallery' and public.is_admin());

-- ---------- Post-event feedback ----------
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  rating      int not null check (rating between 1 and 5),
  comments    text check (comments is null or char_length(comments) <= 2000),
  name        text check (name is null or char_length(name) <= 120),
  created_at  timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "feedback public insert" on public.feedback;
drop policy if exists "feedback admin select" on public.feedback;
drop policy if exists "feedback admin delete" on public.feedback;
-- Feedback only for events that have already happened.
create policy "feedback public insert" on public.feedback for insert to anon, authenticated
  with check (exists (select 1 from public.events e where e.id = event_id
    and (e.status = 'past' or (e.event_date is not null and e.event_date <= current_date))));
create policy "feedback admin select" on public.feedback for select to authenticated using (public.is_admin());
create policy "feedback admin delete" on public.feedback for delete to authenticated using (public.is_admin());
revoke all on public.feedback from anon, authenticated;
grant insert (event_id, rating, comments, name) on public.feedback to anon, authenticated;
grant select, delete on public.feedback to authenticated;

-- ---------- Visitor stats (no IP address, no cookies) ----------
create table if not exists public.page_views (
  id               bigint generated always as identity primary key,
  path             text not null check (char_length(path) between 1 and 200),
  referrer_domain  text check (referrer_domain is null or char_length(referrer_domain) <= 200),
  day              date not null default current_date,
  created_at       timestamptz not null default now()
);
create index if not exists page_views_day_idx on public.page_views(day);
alter table public.page_views enable row level security;
drop policy if exists "page_views admin select" on public.page_views;
create policy "page_views admin select" on public.page_views for select to authenticated using (public.is_admin());
revoke all on public.page_views from anon, authenticated;
grant select on public.page_views to authenticated;

create or replace function public.track_view(p_path text, p_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  p_path := left(coalesce(nullif(btrim(p_path), ''), '/'), 200);
  p_ref := nullif(left(lower(regexp_replace(coalesce(p_ref, ''), '[^a-zA-Z0-9.-]', '', 'g')), 200), '');
  -- Safety cap so the free database can't be flooded.
  if (select count(*) from public.page_views where day = current_date) >= 20000 then return; end if;
  insert into public.page_views (path, referrer_domain) values (p_path, p_ref);
end $$;
revoke all on function public.track_view(text, text) from public;
grant execute on function public.track_view(text, text) to anon, authenticated;

-- Summary for the dashboard (admins only).
create or replace function public.view_stats(p_days int default 30)
returns json language plpgsql stable security definer set search_path = public as $$
declare since date := current_date - greatest(least(coalesce(p_days, 30), 365), 1) + 1;
begin
  if not public.is_admin() then raise exception 'Not allowed' using errcode = '42501'; end if;
  return json_build_object(
    'days',  (select coalesce(json_agg(json_build_object('day', d::date, 'views', coalesce(c, 0)) order by d), '[]')
              from generate_series(since, current_date, interval '1 day') d
              left join (select day, count(*) c from page_views where day >= since group by day) v on v.day = d::date),
    'pages', (select coalesce(json_agg(t), '[]') from (select path, count(*) views from page_views where day >= since group by path order by 2 desc limit 10) t),
    'referrers', (select coalesce(json_agg(t), '[]') from (select referrer_domain, count(*) views from page_views where day >= since and referrer_domain is not null group by 1 order by 2 desc limit 10) t),
    'total', (select count(*) from page_views where day >= since));
end $$;
revoke all on function public.view_stats(int) from public;
grant execute on function public.view_stats(int) to authenticated;

notify pgrst, 'reload schema';
