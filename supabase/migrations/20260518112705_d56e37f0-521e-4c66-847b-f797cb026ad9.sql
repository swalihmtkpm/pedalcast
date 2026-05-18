
-- app_settings: single row holding both passwords
create table public.app_settings (
  id int primary key default 1,
  admin_password text not null,
  user_password text not null,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);

alter table public.app_settings enable row level security;
-- No policies = no client access; server functions use service role.

insert into public.app_settings (id, admin_password, user_password)
values (1, '156786000', '789123');

-- live_session: single row holding broadcast state
create table public.live_session (
  id int primary key default 1,
  is_live boolean not null default false,
  lat double precision,
  lng double precision,
  accuracy double precision,
  speed double precision,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint live_session_singleton check (id = 1)
);

alter table public.live_session enable row level security;

-- Public read so viewers can see live status / GPS in realtime
create policy "Anyone can view live session"
  on public.live_session for select
  using (true);

-- No insert/update/delete policies = only server (service role) can write
insert into public.live_session (id, is_live) values (1, false);

-- Enable realtime
alter publication supabase_realtime add table public.live_session;
alter table public.live_session replica identity full;
