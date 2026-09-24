-- =============================================================================
-- 0002_tables.sql — every application table, its constraints and indexes, the
-- station seed data and updated_at triggers (ARCHITECTURE §5, §6.1).
--
-- Row level security is switched on as each table is created; the policies and
-- table grants live in 0003_access.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stations — seeded, read-only (ARCHITECTURE §5)
-- -----------------------------------------------------------------------------
create table public.stations (
  station int primary key,
  battalion int not null,
  division int not null,
  label text not null,
  sort int not null
);
alter table public.stations enable row level security;

insert into public.stations (station, battalion, division, label, sort)
select st, v.battalion, v.division, 'Station ' || st, st
from (
  values
    -- Division 2
    (1, 2, array[2, 13, 28, 41]),
    (4, 2, array[3, 16, 38, 51]),
    (5, 2, array[5, 10, 12, 21]),
    (7, 2, array[14, 22, 31, 34]),
    (8, 2, array[18, 20, 23, 40]),
    -- Division 3
    (2, 3, array[1, 6, 29, 36]),
    (3, 3, array[4, 8, 35, 48]),
    (6, 3, array[7, 11, 24, 26, 32]),
    (9, 3, array[15, 19, 33, 39, 43]),
    (10, 3, array[9, 17, 25, 37, 42, 44])
) as v(battalion, division, stations)
cross join lateral unnest(v.stations) as st;

-- Airport Division (4), Battalion 99: Airport Stations 1–3.
insert into public.stations (station, battalion, division, label, sort)
values
  (101, 99, 4, 'Airport Station 1', 101),
  (102, 99, 4, 'Airport Station 2', 102),
  (103, 99, 4, 'Airport Station 3', 103);

-- -----------------------------------------------------------------------------
-- roster — department list uploaded by admins. The foreign keys to profiles are
-- added after profiles exists (the two tables reference each other).
-- -----------------------------------------------------------------------------
create table public.roster (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  first_key text not null check (first_key <> ''),   -- public.name_key(first_name)
  last_key text not null check (last_key <> ''),     -- public.name_key(last_name)
  employee_id text check (employee_id is null or char_length(employee_id) between 1 and 40),
  rank text check (rank is null or rank in ('Firefighter', 'Paramedic', 'Lieutenant', 'Captain', 'Battalion Chief', 'Division Chief')),
  station int references public.stations (station),
  tour smallint check (tour between 1 and 31),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 30),
  claimed_by uuid unique,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.roster enable row level security;

-- Import upserts on (last_key, first_key, employee_id) — employee IDs compared
-- case-insensitively, a missing one counts as ''.
create unique index roster_identity_key
  on public.roster (last_key, first_key, (lower(coalesce(employee_id, ''))));
create index roster_unclaimed_last_key_idx on public.roster (last_key) where claimed_by is null;

-- -----------------------------------------------------------------------------
-- profiles — one per auth user, created by the auth.users trigger (0003)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text check (phone is null or phone ~ '^[0-9+() -]{7,20}$'),
  rank text check (rank in ('Firefighter', 'Paramedic', 'Lieutenant', 'Captain', 'Battalion Chief', 'Division Chief')),
  station int references public.stations (station),
  battalion int,                                  -- derived from station by RPCs only
  division int,                                   -- derived from station by RPCs only
  tour smallint check (tour between 1 and 31),    -- null = no tour (relief/detail/40-hour)
  employee_id text check (employee_id is null or char_length(employee_id) between 1 and 40),
  status text not null default 'onboarding'
    check (status in ('onboarding', 'pending', 'approved', 'rejected', 'suspended')),
  status_reason text,
  role text not null default 'member' check (role in ('member', 'admin')),
  roster_id uuid unique references public.roster (id) on delete set null,
  telestaff_ack_at timestamptz,
  must_change_password boolean not null default false,
  notify_scope text not null default 'battalion'
    check (notify_scope in ('off', 'station', 'battalion', 'division', 'all')),
  calendar_token uuid not null default gen_random_uuid() unique,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An onboarded member always has the full location triple.
  constraint profiles_location_complete check (
    (station is null and battalion is null and division is null)
    or (station is not null and battalion is not null and division is not null)
  )
);
alter table public.profiles enable row level security;

create index profiles_status_idx on public.profiles (status);
create index profiles_admins_idx on public.profiles (id) where role = 'admin';
create index profiles_email_idx on public.profiles (lower(email));

alter table public.roster
  add constraint roster_claimed_by_fkey foreign key (claimed_by) references public.profiles (id) on delete set null,
  add constraint roster_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- shifts — a posted shift and, once confirmed, the trade record (§6.1)
-- -----------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  poster_id uuid not null references public.profiles (id),      -- whose shift it is (the one who owes)
  poster_name text not null,                                     -- snapshots taken by RPC
  rank text not null check (rank in ('Firefighter', 'Paramedic', 'Lieutenant', 'Captain', 'Battalion Chief', 'Division Chief')),
  station int not null references public.stations (station),
  battalion int not null,
  division int not null,
  date date not null,                                            -- start date (§3)
  shift_type text not null check (shift_type in ('24-Hour', 'PM')),
  hours smallint not null,
  starts_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'covered', 'cancelled')),
  return_dates date[] not null default '{}',                     -- SwapMatch offers, distinct + sorted
  accept_limit text not null default 'anyone' check (accept_limit in ('anyone', 'division', 'battalion', 'station')),
  notes text check (notes is null or char_length(notes) <= 500),
  coverer_id uuid references public.profiles (id),
  coverer_name text,
  confirmed_at timestamptz,
  return_leg_of uuid references public.shifts (id),             -- set on an auto-created SwapMatch return leg
  return_leg_id uuid references public.shifts (id),             -- set on the original once a SwapMatch is confirmed
  cancel_requested_by uuid references public.profiles (id) on delete set null,
  cancel_requested_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancel_note text check (cancel_note is null or char_length(cancel_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_coverer_not_poster check (coverer_id is null or coverer_id <> poster_id),
  constraint shifts_covered_has_coverer check ((status = 'covered') = (coverer_id is not null)),
  constraint shifts_return_dates_max check (cardinality(return_dates) <= 10),
  constraint shifts_return_dates_no_nulls check (array_position(return_dates, null) is null),
  constraint shifts_hours_match_type check (hours = case shift_type when '24-Hour' then 24 else 16 end),
  constraint shifts_return_leg_has_no_offers check (return_leg_of is null or cardinality(return_dates) = 0),
  constraint shifts_not_own_return_leg check (return_leg_of is null or return_leg_of <> id)
);
alter table public.shifts enable row level security;

-- A member can't give the same day away twice …
create unique index shifts_one_post_per_day
  on public.shifts (poster_id, date) where status in ('open', 'covered');
-- … or cover two shifts on the same day.
create unique index shifts_one_cover_per_day
  on public.shifts (coverer_id, date) where status = 'covered';
create index shifts_status_date_idx on public.shifts (status, date);
create index shifts_battalion_date_idx on public.shifts (battalion, date);
create index shifts_poster_idx on public.shifts (poster_id);
create index shifts_coverer_idx on public.shifts (coverer_id);
create index shifts_return_leg_of_idx on public.shifts (return_leg_of);
create index shifts_board_order_idx on public.shifts (date, created_at, id) where status = 'open';

-- -----------------------------------------------------------------------------
-- shift_requests
-- -----------------------------------------------------------------------------
create table public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  requester_id uuid not null references public.profiles (id),
  requester_name text not null,
  requester_rank text not null,
  requester_station int not null references public.stations (station),
  return_date date,                    -- required iff the shift offers return dates; one of them
  message text check (message is null or char_length(message) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'cancelled')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.shift_requests enable row level security;

create unique index shift_requests_one_pending
  on public.shift_requests (shift_id, requester_id) where status = 'pending';
create index shift_requests_shift_idx on public.shift_requests (shift_id, status);
create index shift_requests_requester_idx on public.shift_requests (requester_id, status);

-- -----------------------------------------------------------------------------
-- messages — 1:1 chat about a shift
-- -----------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  recipient_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 1000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_not_to_self check (sender_id <> recipient_id)
);
alter table public.messages enable row level security;

create index messages_shift_created_idx on public.messages (shift_id, created_at);
create index messages_sender_idx on public.messages (sender_id);
create index messages_recipient_unread_idx on public.messages (recipient_id) where read_at is null;

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'request_received', 'request_accepted', 'request_declined', 'request_withdrawn',
    'post_cancelled', 'cancel_requested', 'trade_cancelled', 'cancel_declined',
    'trade_voided', 'new_shift', 'message', 'member_pending', 'member_auto_approved',
    'member_approved', 'member_rejected', 'account_status'
  )),
  title text not null,
  body text not null,
  url text not null default '/trades',              -- in-app deep link
  shift_id uuid references public.shifts (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;
-- At most one unread chat notification per (recipient, shift, sender); later
-- messages update it instead of stacking up (send_message, §6.3).
create unique index notifications_one_unread_message
  on public.notifications (user_id, shift_id, actor_id) where type = 'message' and read_at is null;

-- -----------------------------------------------------------------------------
-- push_subscriptions
--
-- `endpoint` is a URL the server POSTs to (POST /api/push/flush hands it to
-- web-push), and members insert these rows directly through the Data API. So
-- the database only accepts https URLs on the browser push services, which
-- keeps members from pointing the server at internal addresses (cloud metadata,
-- localhost) or at hosts of their choosing:
--   fcm.googleapis.com, android.googleapis.com,
--   jmt17.google.com                 Chrome, Android, Samsung, Opera, Brave …
--   *.push.services.mozilla.com      Firefox
--   *.push.apple.com                 Safari (macOS, iOS/iPadOS home-screen apps)
--   *.notify.windows.com             Edge on Windows (WNS)
-- The host must be followed directly by "/" (no port, no user info) and the
-- rest may only use URL characters.
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 1 and 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 512),
  auth text not null check (char_length(auth) between 1 and 512),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  constraint push_subscriptions_endpoint_push_service check (
    endpoint ~* ('^https://('
      || 'fcm\.googleapis\.com|android\.googleapis\.com|jmt17\.google\.com'
      || '|([a-z0-9-]+\.)*push\.services\.mozilla\.com'
      || '|([a-z0-9-]+\.)*push\.apple\.com'
      || '|[a-z0-9-]+\.notify\.windows\.com'
      || ')/[a-z0-9._~:/?#@!$&()*+,;=%-]*$')
  )
);
alter table public.push_subscriptions enable row level security;

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- audit_log
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- push_subscriptions: one row per endpoint. A browser endpoint belongs to
-- whoever subscribed last on that device, so a plain INSERT replaces any older
-- row for the same endpoint (members only have INSERT, not UPDATE, and cannot
-- see other members' rows, so an upsert would not work for them).
-- -----------------------------------------------------------------------------
create or replace function private.push_subscription_replace_endpoint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions where endpoint = new.endpoint;
  return new;
end
$$;

create trigger push_subscriptions_replace_endpoint
  before insert on public.push_subscriptions
  for each row execute function private.push_subscription_replace_endpoint();
