-- =============================================================================
-- Minimal Supabase emulation for PGlite (tests only — never apply to a real
-- database). Provides what the migrations and the RLS policies rely on:
--   * roles anon, authenticated, service_role (service_role bypasses RLS)
--   * schema auth with auth.users and auth.uid()/auth.role()/auth.jwt(),
--     implemented like Supabase (request.jwt.claims JSON, falling back to the
--     legacy request.jwt.claim.* settings)
--   * Supabase's default privileges on schema public (ALL to the API roles)
--   * the supabase_realtime publication
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Like Supabase's authenticator: the connecting role can switch to each API role.
grant anon, authenticated, service_role to postgres;

grant usage on schema public to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- auth schema
-- -----------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Supabase's default privileges: everything new in public is granted to the
-- API roles. The migrations must revoke these explicitly (tests check it).
-- -----------------------------------------------------------------------------
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Realtime publication (empty, like a fresh Supabase project)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
