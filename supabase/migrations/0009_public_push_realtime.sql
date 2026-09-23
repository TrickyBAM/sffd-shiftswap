-- =============================================================================
-- 0009_public_push_realtime.sql — anonymous endpoints (§6.3 "Public"),
-- server-only helpers (push claiming, sign-up rate limiting), the push webhook
-- trigger (§6.5) and the realtime publication (§6.7).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_keepalive — used by /api/keepalive (and an external pinger) so the free
-- tier database registers activity. Anyone may call it.
-- -----------------------------------------------------------------------------
create or replace function public.app_keepalive()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform 1 from public.stations limit 1;
  return jsonb_build_object('ok', true);
end
$$;

-- -----------------------------------------------------------------------------
-- calendar_feed — the ICS subscription (/api/calendar/<token>) for an approved
-- member's secret token, today−30 … today+365:
--   work            my tour day that I did not give away
--   covering        a shift I picked up (not part of a SwapMatch)
--   swap            a SwapMatch leg I work (either direction)
--   covered_for_me  my tour day that someone else covers (I'm off)
-- An unknown token, or one belonging to a member who isn't approved, returns
-- no rows. Callable without signing in; the token is the secret.
-- -----------------------------------------------------------------------------
create or replace function public.calendar_feed(p_token uuid)
returns table (date date, kind text, title text, details text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id, p.tour, p.station
    from public.profiles p
    where p_token is not null and p.calendar_token = p_token and p.status = 'approved'
  ),
  bounds as (
    select public.today_pt() - 30 as first_day, public.today_pt() + 365 as last_day
  ),
  work as (
    select b.first_day + i as day, me.id, me.tour, me.station
    from me
    cross join bounds b
    cross join generate_series(0, 395) as g(i)
    where me.tour is not null and public.tour_works(me.tour, b.first_day + i)
  )
  select w.day, 'work'::text,
         pg_catalog.format('On duty (Tour %s)', w.tour),
         pg_catalog.format('%s · your tour day. ShiftSwap is unofficial: TeleStaff is the official schedule.',
           private.station_label(w.station))
  from work w
  where not exists (
    select 1 from public.shifts g
    where g.poster_id = w.id and g.date = w.day and g.status = 'covered'
  )
  union all
  select s.date,
         case when s.return_leg_of is not null or s.return_leg_id is not null then 'swap' else 'covering' end,
         case when s.return_leg_of is not null or s.return_leg_id is not null
           then pg_catalog.format('SwapMatch: working for %s (%s)', s.poster_name, s.shift_type)
           else pg_catalog.format('Covering %s (%s)', s.poster_name, s.shift_type)
         end,
         pg_catalog.format('%s · %s · %s hours. Traded in ShiftSwap: make sure it is approved in TeleStaff.',
           private.station_label(s.station), s.shift_type, s.hours)
  from me
  cross join bounds b
  join public.shifts s on s.coverer_id = me.id and s.status = 'covered'
  where s.date between b.first_day and b.last_day
  union all
  select s.date, 'covered_for_me'::text,
         pg_catalog.format('Off: %s covering you (%s)', s.coverer_name, s.shift_type),
         pg_catalog.format('%s · %s · %s hours%s. Traded in ShiftSwap: make sure it is approved in TeleStaff.',
           private.station_label(s.station), s.shift_type, s.hours,
           case when s.return_leg_of is not null or s.return_leg_id is not null then ' · SwapMatch' else '' end)
  from me
  cross join bounds b
  join public.shifts s on s.poster_id = me.id and s.status = 'covered'
  where s.date between b.first_day and b.last_day
  order by 1, 2
$$;

-- -----------------------------------------------------------------------------
-- claim_push_batch — service role only (POST /api/push/flush). Atomically
-- claims up to p_limit (default 200, max 500) notifications that were never
-- pushed, are unread and were created in the last 2 days, marks them pushed
-- and returns them. SKIP LOCKED lets concurrent flushes split the work
-- instead of sending duplicates.
-- -----------------------------------------------------------------------------
create or replace function public.claim_push_batch(p_limit int default 200)
returns table (notification_id uuid, user_id uuid, title text, body text, url text)
language sql
security definer
set search_path = ''
as $$
  with claimable as (
    select n.id
    from public.notifications n
    where n.pushed_at is null
      and n.read_at is null
      and n.created_at > pg_catalog.now() - interval '2 days'
    order by n.created_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  )
  update public.notifications n
     set pushed_at = pg_catalog.now()
    from claimable c
   where n.id = c.id
  returning n.id, n.user_id, n.title, n.body, n.url
$$;

-- -----------------------------------------------------------------------------
-- signup_rate_check — service role only (server-side sign-up route). Records an
-- attempt for a hashed client IP and returns false once that IP has made
-- p_max attempts within p_window_minutes (blocked attempts are not recorded).
-- Attempts older than a day are pruned.
-- -----------------------------------------------------------------------------
create or replace function public.signup_rate_check(
  p_ip_hash text,
  p_max int default 5,
  p_window_minutes int default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent int;
begin
  if p_ip_hash is null or char_length(p_ip_hash) = 0 or char_length(p_ip_hash) > 128 then
    perform private.fail('A client key is required.', 'INVALID_INPUT');
  end if;

  delete from private.signup_attempts a where a.created_at < now() - interval '1 day';

  select count(*) into v_recent
  from private.signup_attempts a
  where a.ip_hash = p_ip_hash
    and a.created_at > now() - make_interval(mins => greatest(coalesce(p_window_minutes, 60), 1));

  if v_recent >= greatest(coalesce(p_max, 5), 1) then
    return false;
  end if;

  insert into private.signup_attempts (ip_hash) values (p_ip_hash);
  return true;
end
$$;

-- -----------------------------------------------------------------------------
-- Push webhook (§6.5). After notifications are inserted, ask the app to flush
-- pushes via pg_net — only when pg_net is installed and both
-- private.app_config keys (push_webhook_url, push_webhook_secret) are set.
-- Otherwise it does nothing (PGlite, fresh projects); the client also calls
-- /api/push/flush after every mutating RPC. At most one call per transaction,
-- and a failure here never blocks the insert.
-- -----------------------------------------------------------------------------
create or replace function private.notify_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if coalesce(current_setting('sffd.push_webhook_queued', true), '') = 'on' then
    return null;
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return null;
  end if;

  select c.value into v_url from private.app_config c where c.key = 'push_webhook_url';
  select c.value into v_secret from private.app_config c where c.key = 'push_webhook_secret';
  if coalesce(btrim(v_url), '') = '' or coalesce(btrim(v_secret), '') = '' then
    return null;
  end if;

  begin
    execute 'select net.http_post(url => $1, body => $2, params => $3, headers => $4, timeout_milliseconds => $5)'
      using v_url,
            jsonb_build_object('source', 'notifications'),
            '{}'::jsonb,
            jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
            5000;
    perform set_config('sffd.push_webhook_queued', 'on', true);
  exception when others then
    raise warning 'push webhook call failed: %', sqlerrm;
  end;
  return null;
end
$$;

create trigger notifications_push_webhook
  after insert on public.notifications
  for each statement execute function private.notify_push_webhook();

-- -----------------------------------------------------------------------------
-- Realtime (§6.7): publish the tables clients watch, if Supabase Realtime's
-- publication exists. Clients treat events only as "something changed".
-- -----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found; skipping realtime setup';
    return;
  end if;
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime' and puballtables) then
    raise notice 'publication supabase_realtime already covers all tables';
    return;
  end if;
  foreach v_table in array array['shifts', 'shift_requests', 'notifications', 'messages'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables t
      where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = v_table
    ) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      exception when insufficient_privilege then
        raise warning 'could not add public.% to supabase_realtime: %', v_table, sqlerrm;
      end;
    end if;
  end loop;
end
$$;
