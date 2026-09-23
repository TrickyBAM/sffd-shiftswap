-- =============================================================================
-- 0001_foundation.sql — schemas, default privileges, internal config tables and
-- the pure helper functions everything else builds on (ARCHITECTURE §3, §4, §6).
--
-- Runs on Supabase (Postgres 15/17, as role postgres) and on PGlite (Postgres
-- 18) after tests/db/supabase-stub.sql. Applied inside a transaction by
-- scripts/db/migrate.mjs, so this file contains no BEGIN/COMMIT.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schemas
-- -----------------------------------------------------------------------------

-- `private` holds internal config and helper functions. It is not exposed through
-- the Supabase Data API and no client role gets USAGE on it.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Default privileges
--
-- Supabase grants ALL on new tables/sequences/functions in schema public to
-- anon + authenticated (and Postgres grants EXECUTE on every new function to
-- PUBLIC). Stop that for objects created by the migration role, so nothing new
-- is ever exposed by accident: every grant in this project is explicit
-- (see 0003_access.sql and 0010_privileges.sql).
-- -----------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
-- The PUBLIC execute grant on functions is global (not per schema), so it can
-- only be revoked globally. This affects functions created by this role only.
alter default privileges revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Internal tables (schema private — service role / migration tooling only)
-- -----------------------------------------------------------------------------

-- Applied migration files. scripts/db/migrate.mjs also creates this table
-- before applying 0001, hence `if not exists`.
create table if not exists private.schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);

-- Key/value settings read by database code, e.g. push_webhook_url and
-- push_webhook_secret (set with scripts/db/set-app-config.mjs).
create table private.app_config (
  key text primary key,
  value text not null
);

-- Hashed client IPs of sign-up attempts, for rate limiting the server-side
-- sign-up route (see public.signup_rate_check in 0009).
create table private.signup_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index signup_attempts_ip_created_idx on private.signup_attempts (ip_hash, created_at);

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Pure helpers (schema public, safe to expose — see 0010_privileges.sql)
-- -----------------------------------------------------------------------------

-- Today's calendar date in San Francisco. Never use current_date: it follows the
-- session time zone (UTC on Supabase).
create or replace function public.today_pt()
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'America/Los_Angeles')::date
$$;

comment on function public.today_pt() is
  'Current date in America/Los_Angeles (ARCHITECTURE §3).';

-- The instant a shift starts: 08:00 (24-Hour) or 16:00 (PM) Pacific time on its
-- start date. Null for an unknown shift type.
create or replace function public.shift_starts_at(p_date date, p_shift_type text)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_shift_type
    when '24-Hour' then (p_date + time '08:00') at time zone 'America/Los_Angeles'
    when 'PM' then (p_date + time '16:00') at time zone 'America/Los_Angeles'
  end
$$;

comment on function public.shift_starts_at(date, text) is
  'Start instant of a shift: date + 08:00 (24-Hour) or 16:00 (PM) in America/Los_Angeles.';

-- SFFD 31-day tour rotation (ARCHITECTURE §4). 2019-01-01 is Watch 1; Tour 1
-- works cycle offsets {0,3,6,10,13,16,20,23,26}; Tour N is Tour 1 shifted N−1
-- days. False for a null/out-of-range tour or a null date.
-- Mirrored by src/lib/sffd/tours.ts (tests compare both against a fixture).
create or replace function public.tour_works(p_tour smallint, p_date date)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    p_tour between 1 and 31
      and ((((p_date - date '2019-01-01') - (p_tour - 1)) % 31) + 31) % 31
          = any (array[0, 3, 6, 10, 13, 16, 20, 23, 26]),
    false
  )
$$;

comment on function public.tour_works(smallint, date) is
  'True when SFFD tour p_tour (1-31) is on duty on p_date by base schedule (ARCHITECTURE §4).';

-- Canonical name key for roster matching (ARCHITECTURE §6.1). MUST stay
-- identical to nameKey() in src/lib/roster/normalize.ts:
--   1. lowercase
--   2. áàâäãå→a éèêë→e íìîï→i óòôöõø→o úùûü→u ñ→n ç→c ýÿ→y
--   3. drop every character that is not a–z
-- The upper-case accented letters are mapped too, so the result does not depend
-- on the database's LC_CTYPE (lower() only folds ASCII under the C locale).
create or replace function public.name_key(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.translate(
      pg_catalog.lower(coalesce(p_value, '')),
      'áàâäãåéèêëíìîïóòôöõøúùûüñçýÿÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕØÚÙÛÜÑÇÝŸ',
      'aaaaaaeeeeiiiioooooouuuuncyyaaaaaaeeeeiiiioooooouuuuncyy'
    ),
    '[^a-z]', '', 'g'
  )
$$;

comment on function public.name_key(text) is
  'Normalized name key: lowercase, accents folded, only a-z kept. Mirrors src/lib/roster/normalize.ts.';

-- -----------------------------------------------------------------------------
-- Internal helpers (schema private)
-- -----------------------------------------------------------------------------

-- Raise a member-facing error: the client shows `message` and may branch on the
-- hint code (ARCHITECTURE §6.6).
create or replace function private.fail(p_message text, p_hint text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = p_message, errcode = 'P0001', hint = p_hint;
end
$$;

-- The six fire-side ranks, in order (ARCHITECTURE §5).
create or replace function private.ranks()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['Firefighter', 'Paramedic', 'Lieutenant', 'Captain', 'Battalion Chief', 'Division Chief']
$$;

-- Trims a person's name and collapses internal whitespace; null when blank.
create or replace function private.clean_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), '')
$$;

-- Short, locale-independent date label used in notification text: "Wed Sep 23".
create or replace function private.fmt_date(p_date date)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.to_char(p_date, 'Dy Mon FMDD')
$$;

-- Phone numbers: digits, +, -, (, ), space; 7–20 characters (ARCHITECTURE §6.1).
create or replace function private.valid_phone(p_phone text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_phone ~ '^[0-9+() -]{7,20}$', false)
$$;
