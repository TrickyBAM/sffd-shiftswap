-- =============================================================================
-- 0003_access.sql — auth.users triggers, the is_approved()/is_admin() helpers,
-- row level security policies and table grants (ARCHITECTURE §6.2).
--
-- Grants are explicit: Supabase would otherwise give anon/authenticated ALL on
-- every public table. anon gets no table access at all; its only entry points
-- are app_keepalive() and calendar_feed() (see 0010_privileges.sql).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New auth user ⇒ profile row. The server-side sign-up route passes the member's
-- name as user_metadata.full_name; it is trimmed, whitespace-collapsed and
-- truncated to 80 characters. Everything else is filled in at onboarding.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    pg_catalog.lower(pg_catalog.btrim(coalesce(new.email, ''))),
    coalesce(
      pg_catalog.btrim(pg_catalog.left(private.clean_name(new.raw_user_meta_data ->> 'full_name'), 80)),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step if an admin changes a login email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set email = pg_catalog.lower(pg_catalog.btrim(coalesce(new.email, '')))
   where id = new.id;
  return new;
end
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- Membership helpers used by RLS policies. SECURITY DEFINER so that reading the
-- caller's own profile row does not recurse through the profiles policies.
-- -----------------------------------------------------------------------------
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'approved'
  )
$$;

comment on function public.is_approved() is
  'True when the signed-in caller is an approved member (pending/rejected/suspended are not).';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved'
  )
$$;

comment on function public.is_admin() is
  'True when the signed-in caller is an approved admin. A suspended admin has no admin rights.';

-- -----------------------------------------------------------------------------
-- Table grants. Start from nothing, then grant exactly the cells in §6.2.
-- service_role (server-side only: sign-up, admin password reset, push flush)
-- bypasses RLS and keeps plain DML on every public table.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.stations to authenticated;
grant select on public.profiles to authenticated;
grant select, delete on public.roster to authenticated;
grant select on public.shifts to authenticated;
grant select on public.shift_requests to authenticated;
grant select on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, user_agent) on public.push_subscriptions to authenticated;
grant select on public.audit_log to authenticated;

-- -----------------------------------------------------------------------------
-- Row level security policies (RLS itself was enabled in 0002)
-- `(select auth.uid())` is evaluated once per statement instead of per row.
-- -----------------------------------------------------------------------------

-- stations: everyone signed in may read.
create policy stations_select on public.stations
  for select to authenticated
  using (true);

-- profiles: own row; admins all. Other members' phone/email are only ever
-- exposed through get_trade_contact(). Writes go through RPCs only.
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

-- roster: admins read and delete; import goes through admin_import_roster().
create policy roster_select_admin on public.roster
  for select to authenticated
  using ((select public.is_admin()));

create policy roster_delete_admin on public.roster
  for delete to authenticated
  using ((select public.is_admin()));

-- shifts: approved members read everything; writes are RPC-only.
create policy shifts_select_approved on public.shifts
  for select to authenticated
  using ((select public.is_approved()));

-- shift_requests: the requester, the shift's poster, admins.
create policy shift_requests_select_party on public.shift_requests
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or exists (
      select 1 from public.shifts s
      where s.id = shift_requests.shift_id and s.poster_id = (select auth.uid())
    )
    or (select public.is_admin())
  );

-- messages: sender or recipient read; the recipient may set read_at (column grant).
create policy messages_select_party on public.messages
  for select to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy messages_update_recipient on public.messages
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- notifications: own rows; read_at may be set (column grant); may delete.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- push_subscriptions: own rows only.
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- audit_log: admins read.
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using ((select public.is_admin()));
