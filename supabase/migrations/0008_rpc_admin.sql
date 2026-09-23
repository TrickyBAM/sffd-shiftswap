-- =============================================================================
-- 0008_rpc_admin.sql — admin RPCs (ARCHITECTURE §6.3 "Admin"). Every function
-- requires an approved admin caller (NOT_ADMIN otherwise) and writes an audit
-- log entry.
-- =============================================================================

-- Locks and returns a member's profile for an admin action; NOT_FOUND if missing.
create or replace function private.lock_member(p_user_id uuid)
returns public.profiles
language plpgsql
set search_path = ''
as $$
declare
  v_member public.profiles;
begin
  select * into v_member from public.profiles p where p.id = p_user_id for update;
  if not found then
    perform private.fail('That member wasn''t found.', 'NOT_FOUND');
  end if;
  return v_member;
end
$$;

-- Number of approved admins other than p_user_id. Locks every admin row so two
-- concurrent demotions can't both pass the "last admin" check.
create or replace function private.other_admin_count(p_user_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.profiles p where p.role = 'admin' for update;
  select count(*) into v_count
  from public.profiles p
  where p.role = 'admin' and p.status = 'approved' and p.id <> p_user_id;
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- admin_approve_member — approve a pending/rejected/suspended member, optionally
-- linking (claiming) a roster entry.
-- -----------------------------------------------------------------------------
create or replace function public.admin_approve_member(p_user_id uuid, p_roster_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_member public.profiles := private.lock_member(p_user_id);
  v_roster public.roster;
begin
  if v_member.status = 'approved' then
    perform private.fail('This member is already approved.', 'INVALID_INPUT');
  end if;
  if v_member.status = 'onboarding' or v_member.rank is null or v_member.station is null then
    perform private.fail('This member hasn''t finished setting up their profile yet.', 'INVALID_INPUT');
  end if;

  if p_roster_id is not null then
    select * into v_roster from public.roster r where r.id = p_roster_id for update;
    if not found then
      perform private.fail('That roster entry wasn''t found.', 'NOT_FOUND');
    end if;
    if v_roster.claimed_by is not null and v_roster.claimed_by <> v_member.id then
      perform private.fail('That roster entry is already linked to another member.', 'INVALID_INPUT');
    end if;
    -- Release any roster row the member was linked to before.
    update public.roster r set claimed_by = null
     where r.claimed_by = v_member.id and r.id <> v_roster.id;
    update public.roster r set claimed_by = v_member.id where r.id = v_roster.id;
  end if;

  update public.profiles p
     set status = 'approved',
         status_reason = null,
         roster_id = coalesce(p_roster_id, p.roster_id),
         approved_at = now(),
         approved_by = v_admin.id
   where p.id = v_member.id;

  perform private.notify(
    v_member.id, 'member_approved', 'You''re approved',
    'An admin approved your ShiftSwap account. You can post and request shifts now.',
    '/calendar', null, v_admin.id);
  perform private.audit(v_admin.id, 'admin.member_approved', 'profile', v_member.id,
    jsonb_build_object('from_status', v_member.status, 'roster_id', p_roster_id));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_reject_member — turn down an applicant (onboarding/pending).
-- -----------------------------------------------------------------------------
create or replace function public.admin_reject_member(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_member public.profiles := private.lock_member(p_user_id);
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_member.id = v_admin.id then
    perform private.fail('You can''t reject yourself.', 'INVALID_INPUT');
  end if;
  if v_member.status not in ('onboarding', 'pending') then
    perform private.fail('Only members waiting for approval can be rejected. Suspend active members instead.', 'INVALID_INPUT');
  end if;
  if char_length(v_reason) > 500 then
    perform private.fail('Keep the reason under 500 characters.', 'INVALID_INPUT');
  end if;

  update public.profiles p
     set status = 'rejected', status_reason = v_reason
   where p.id = v_member.id;

  perform private.notify(
    v_member.id, 'member_rejected', 'Account not approved',
    coalesce('An admin didn''t approve your ShiftSwap account: ' || v_reason,
             'An admin didn''t approve your ShiftSwap account. Contact an admin if you think this is a mistake.'),
    '/pending', null, v_admin.id);
  perform private.audit(v_admin.id, 'admin.member_rejected', 'profile', v_member.id,
    jsonb_build_object('from_status', v_member.status, 'reason', v_reason));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_set_member_status — suspend an active member or reinstate one
-- (approved|suspended). The last active admin can't be suspended.
--
-- Suspending takes the member out of trading: a suspended member can't confirm
-- anything, so their upcoming open posts are cancelled (requesters told) and
-- their own pending requests are closed (posters told). Otherwise the posts
-- would sit on the board forever and anyone requesting one could read the
-- suspended member's phone and email through get_trade_contact. Confirmed
-- trades stay as they are; an admin can void them. Reinstating restores
-- nothing: the member posts again.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_member_status(p_user_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_member public.profiles := private.lock_member(p_user_id);
  v_reason text := nullif(btrim(p_reason), '');
  v_posts_cancelled int := 0;
  v_requests_closed int := 0;
begin
  if p_status is null or p_status not in ('approved', 'suspended') then
    perform private.fail('Status must be approved or suspended.', 'INVALID_INPUT');
  end if;
  if v_member.id = v_admin.id then
    perform private.fail('You can''t change your own status.', 'INVALID_INPUT');
  end if;
  if v_member.status = 'onboarding' or v_member.rank is null or v_member.station is null then
    perform private.fail('This member hasn''t finished setting up their profile yet.', 'INVALID_INPUT');
  end if;
  if char_length(v_reason) > 500 then
    perform private.fail('Keep the reason under 500 characters.', 'INVALID_INPUT');
  end if;
  if p_status = 'suspended' and v_member.role = 'admin' and private.other_admin_count(v_member.id) = 0 then
    perform private.fail('You can''t suspend the last admin.', 'LAST_ADMIN');
  end if;
  if v_member.status = p_status then
    return;
  end if;

  update public.profiles p
     set status = p_status,
         status_reason = v_reason,
         approved_at = case when p_status = 'approved' then coalesce(p.approved_at, now()) else p.approved_at end,
         approved_by = case when p_status = 'approved' then coalesce(p.approved_by, v_admin.id) else p.approved_by end
   where p.id = v_member.id;

  if p_status = 'suspended' then
    -- Upcoming open posts come off the board; their pending requests close.
    with posts as (
      update public.shifts s
         set status = 'cancelled',
             cancelled_at = now(),
             cancelled_by = v_admin.id,
             cancel_note = 'Taken down: the member''s account was suspended.'
       where s.poster_id = v_member.id and s.status = 'open' and s.starts_at > now()
      returning s.id, s.date, s.shift_type
    ),
    closed as (
      update public.shift_requests r
         set status = 'cancelled', decided_at = now()
        from posts
       where r.shift_id = posts.id and r.status = 'pending'
      returning r.requester_id, posts.id as shift_id, posts.date, posts.shift_type
    ),
    told as (
      insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
      select c.requester_id, 'post_cancelled',
             format('%s shift no longer available', private.fmt_date(c.date)),
             format('%s''s %s %s post was taken down, so your request was closed.',
                    v_member.full_name, private.fmt_date(c.date), c.shift_type),
             '/trades', c.shift_id, v_admin.id
      from closed c
      returning 1
    )
    select count(*)::int into v_posts_cancelled from posts;

    -- The member's own pending requests on other members' shifts close too.
    with mine as (
      update public.shift_requests r
         set status = 'cancelled', decided_at = now()
        from public.shifts s
       where r.requester_id = v_member.id and r.status = 'pending' and s.id = r.shift_id
      returning r.shift_id, s.poster_id, s.date, s.shift_type
    ),
    told as (
      insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
      select m.poster_id, 'request_withdrawn',
             format('%s''s request was closed', v_member.full_name),
             format('%s''s request for your %s %s shift was closed.',
                    v_member.full_name, private.fmt_date(m.date), m.shift_type),
             '/trades/' || m.shift_id, m.shift_id, v_admin.id
      from mine m
      returning 1
    )
    select count(*)::int into v_requests_closed from mine;
  end if;

  perform private.notify(
    v_member.id, 'account_status',
    case p_status when 'suspended' then 'Account suspended' else 'Account active again' end,
    case p_status
      when 'suspended' then coalesce('An admin suspended your ShiftSwap account: ' || v_reason,
                                     'An admin suspended your ShiftSwap account.')
        || case when v_posts_cancelled > 0 then ' Your open posts were taken down.' else '' end
      else 'An admin reinstated your ShiftSwap account.'
    end,
    '/calendar', null, v_admin.id);
  perform private.audit(v_admin.id, 'admin.member_status', 'profile', v_member.id,
    jsonb_build_object('from', v_member.status, 'to', p_status, 'reason', v_reason,
      'posts_cancelled', v_posts_cancelled, 'requests_closed', v_requests_closed));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_set_role — member|admin. There must always be at least one approved
-- admin (LAST_ADMIN).
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_member public.profiles := private.lock_member(p_user_id);
begin
  if p_role is null or p_role not in ('member', 'admin') then
    perform private.fail('Role must be member or admin.', 'INVALID_INPUT');
  end if;
  if v_member.role = p_role then
    return;
  end if;
  if p_role = 'admin' and v_member.status <> 'approved' then
    perform private.fail('Approve this member before making them an admin.', 'INVALID_INPUT');
  end if;
  if p_role = 'member' and private.other_admin_count(v_member.id) = 0 then
    perform private.fail('You can''t remove the last admin. Make someone else an admin first.', 'LAST_ADMIN');
  end if;

  update public.profiles p set role = p_role where p.id = v_member.id;

  perform private.notify(
    v_member.id, 'account_status',
    case p_role when 'admin' then 'You''re now an admin' else 'Admin access removed' end,
    case p_role
      when 'admin' then 'An admin gave you admin access to ShiftSwap.'
      else 'Your ShiftSwap admin access was removed.'
    end,
    case p_role when 'admin' then '/admin' else '/profile' end, null, v_admin.id);
  perform private.audit(v_admin.id, 'admin.member_role', 'profile', v_member.id,
    jsonb_build_object('from', v_member.role, 'to', p_role));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_update_member — name, rank, station, tour, phone, employee ID.
-- -----------------------------------------------------------------------------
create or replace function public.admin_update_member(
  p_user_id uuid,
  p_full_name text,
  p_rank text,
  p_station int,
  p_tour int,
  p_phone text,
  p_employee_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_member public.profiles := private.lock_member(p_user_id);
  v_name text := private.clean_name(p_full_name);
  v_phone text := btrim(p_phone);
  v_emp text := nullif(btrim(p_employee_id), '');
  v_station public.stations;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    perform private.fail('Enter the member''s full name (2 to 80 characters).', 'INVALID_INPUT');
  end if;
  if not private.valid_phone(v_phone) then
    perform private.fail('Enter a valid phone number (7 to 20 digits, spaces, +, -, or parentheses).', 'INVALID_INPUT');
  end if;
  if p_rank is null or not (p_rank = any (private.ranks())) then
    perform private.fail('Choose a rank.', 'INVALID_INPUT');
  end if;
  select * into v_station from public.stations s where s.station = p_station;
  if not found then
    perform private.fail('Choose a station.', 'INVALID_INPUT');
  end if;
  if p_tour is not null and (p_tour < 1 or p_tour > 31) then
    perform private.fail('Tour must be between 1 and 31, or No tour.', 'INVALID_INPUT');
  end if;
  if char_length(v_emp) > 40 then
    perform private.fail('Employee ID is too long.', 'INVALID_INPUT');
  end if;

  update public.profiles p
     set full_name = v_name,
         rank = p_rank,
         station = v_station.station,
         battalion = v_station.battalion,
         division = v_station.division,
         tour = p_tour,
         phone = v_phone,
         employee_id = v_emp
   where p.id = v_member.id;

  perform private.audit(v_admin.id, 'admin.member_updated', 'profile', v_member.id, jsonb_build_object(
    'before', jsonb_build_object('full_name', v_member.full_name, 'rank', v_member.rank, 'station', v_member.station,
                                 'tour', v_member.tour, 'phone', v_member.phone, 'employee_id', v_member.employee_id),
    'after', jsonb_build_object('full_name', v_name, 'rank', p_rank, 'station', v_station.station,
                                'tour', p_tour, 'phone', v_phone, 'employee_id', v_emp)));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_mark_must_change_password — after an admin sets a temporary password
-- (server route with the service key), force a change at next sign-in.
-- -----------------------------------------------------------------------------
create or replace function public.admin_mark_must_change_password(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_member public.profiles := private.lock_member(p_user_id);
begin
  update public.profiles p set must_change_password = true where p.id = v_member.id;
  perform private.audit(v_admin.id, 'admin.password_reset', 'profile', v_member.id, '{}'::jsonb);
end
$$;

-- -----------------------------------------------------------------------------
-- admin_import_roster — rows [{first_name, last_name, employee_id?, rank?,
-- station?, tour?, email?, phone?}]. Invalid rows are reported and skipped
-- over; p_replace first deletes every *unclaimed* roster row. Upserts on
-- (last_key, first_key, employee_id). Returns
-- {inserted, updated, skipped, deleted, errors: [{row, message}]} where `row`
-- is 1-based and `skipped` counts rows identical to an existing entry or
-- repeated within the import.
-- -----------------------------------------------------------------------------
create or replace function public.admin_import_roster(p_rows jsonb, p_replace boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_item jsonb;
  v_idx int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_deleted int := 0;
  v_seen text[] := '{}';
  v_key text;
  v_first text;
  v_last text;
  v_first_key text;
  v_last_key text;
  v_emp text;
  v_rank_in text;
  v_rank text;
  v_station_in text;
  v_station int;
  v_tour_in text;
  v_tour smallint;
  v_email text;
  v_phone text;
  v_existing public.roster;
  v_err text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    perform private.fail('The roster must be a list of rows.', 'INVALID_INPUT');
  end if;
  if jsonb_array_length(p_rows) > 10000 then
    perform private.fail('Import at most 10,000 rows at a time.', 'INVALID_INPUT');
  end if;

  if coalesce(p_replace, false) then
    delete from public.roster r where r.claimed_by is null;
    get diagnostics v_deleted = row_count;
  end if;

  for v_item in select e from jsonb_array_elements(p_rows) as t(e) loop
    v_idx := v_idx + 1;
    v_err := null;

    if jsonb_typeof(v_item) <> 'object' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_idx, 'message', 'Row is not a record.'));
      continue;
    end if;

    v_first := private.clean_name(v_item ->> 'first_name');
    v_last := private.clean_name(v_item ->> 'last_name');
    v_first_key := public.name_key(v_first);
    v_last_key := public.name_key(v_last);
    v_emp := nullif(btrim(v_item ->> 'employee_id'), '');
    v_rank_in := nullif(btrim(v_item ->> 'rank'), '');
    v_station_in := nullif(btrim(v_item ->> 'station'), '');
    v_tour_in := nullif(btrim(v_item ->> 'tour'), '');
    v_email := lower(nullif(btrim(v_item ->> 'email'), ''));
    v_phone := nullif(btrim(v_item ->> 'phone'), '');
    v_rank := null;
    v_station := null;
    v_tour := null;

    if v_first is null or v_last is null then
      v_err := 'First and last name are required.';
    elsif v_first_key = '' or v_last_key = '' then
      v_err := 'Names must contain letters.';
    elsif char_length(v_first) > 80 or char_length(v_last) > 80 then
      v_err := 'Names can be at most 80 characters.';
    elsif char_length(v_emp) > 40 then
      v_err := 'Employee ID is too long.';
    elsif char_length(v_email) > 254 or char_length(v_phone) > 30 then
      v_err := 'Email or phone is too long.';
    end if;

    if v_err is null and v_rank_in is not null then
      select t.rank_name into v_rank
      from unnest(private.ranks()) as t(rank_name)
      where lower(t.rank_name) = lower(v_rank_in);
      if v_rank is null then
        v_err := format('Unknown rank "%s".', left(v_rank_in, 40));
      end if;
    end if;

    if v_err is null and v_station_in is not null then
      if v_station_in !~ '^[0-9]{1,4}$' then
        v_err := format('Station "%s" is not a number.', left(v_station_in, 20));
      else
        select s.station into v_station from public.stations s where s.station = v_station_in::int;
        if v_station is null then
          v_err := format('Unknown station %s.', v_station_in);
        end if;
      end if;
    end if;

    if v_err is null and v_tour_in is not null then
      if v_tour_in ~ '^[0-9]{1,2}$' then
        v_tour := v_tour_in::smallint;
      end if;
      if v_tour is null or v_tour not between 1 and 31 then
        v_tour := null;
        v_err := format('Tour "%s" must be a number from 1 to 31.', left(v_tour_in, 20));
      end if;
    end if;

    if v_err is not null then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_idx, 'message', v_err));
      continue;
    end if;

    -- Same person twice in one file: keep the first.
    v_key := v_last_key || '|' || v_first_key || '|' || lower(coalesce(v_emp, ''));
    if v_key = any (v_seen) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_seen := v_seen || v_key;

    select * into v_existing
    from public.roster r
    where r.last_key = v_last_key
      and r.first_key = v_first_key
      and lower(coalesce(r.employee_id, '')) = lower(coalesce(v_emp, ''))
    for update;

    if found then
      if (v_existing.first_name, v_existing.last_name, v_existing.employee_id, v_existing.rank,
          v_existing.station, v_existing.tour, v_existing.email, v_existing.phone)
         is not distinct from
         (v_first, v_last, v_emp, v_rank, v_station, v_tour, v_email, v_phone) then
        v_skipped := v_skipped + 1;
      else
        update public.roster r
           set first_name = v_first, last_name = v_last, employee_id = v_emp, rank = v_rank,
               station = v_station, tour = v_tour, email = v_email, phone = v_phone
         where r.id = v_existing.id;
        v_updated := v_updated + 1;
      end if;
    else
      insert into public.roster (first_name, last_name, first_key, last_key, employee_id, rank,
                                 station, tour, email, phone, created_by)
      values (v_first, v_last, v_first_key, v_last_key, v_emp, v_rank,
              v_station, v_tour, v_email, v_phone, v_admin.id);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  perform private.audit(v_admin.id, 'admin.roster_imported', 'roster', null, jsonb_build_object(
    'replace', coalesce(p_replace, false), 'deleted', v_deleted, 'inserted', v_inserted,
    'updated', v_updated, 'skipped', v_skipped, 'errors', jsonb_array_length(v_errors)));

  return jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'deleted', v_deleted,
    'errors', v_errors
  );
end
$$;

-- -----------------------------------------------------------------------------
-- admin_delete_roster_entry — a claimed entry is unlinked from its member.
-- -----------------------------------------------------------------------------
create or replace function public.admin_delete_roster_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_row public.roster;
begin
  delete from public.roster r where r.id = p_id returning * into v_row;
  if v_row.id is null then
    perform private.fail('That roster entry wasn''t found.', 'NOT_FOUND');
  end if;
  perform private.audit(v_admin.id, 'admin.roster_deleted', 'roster', v_row.id, jsonb_build_object(
    'first_name', v_row.first_name, 'last_name', v_row.last_name, 'claimed_by', v_row.claimed_by));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_cancel_post — take down an open post (even after it started).
-- -----------------------------------------------------------------------------
create or replace function public.admin_cancel_post(p_shift_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_reason text := nullif(btrim(p_reason), '');
  v_shift public.shifts;
begin
  if char_length(v_reason) > 500 then
    perform private.fail('Keep the reason under 500 characters.', 'INVALID_INPUT');
  end if;
  select * into v_shift from public.shifts s where s.id = p_shift_id for update;
  if not found then
    perform private.fail('That shift no longer exists.', 'NOT_FOUND');
  end if;
  if v_shift.status <> 'open' then
    perform private.fail('Only open posts can be taken down. Use void for confirmed trades.', 'NOT_OPEN');
  end if;

  update public.shifts s
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_admin.id, cancel_note = v_reason
   where s.id = v_shift.id;

  with cancelled as (
    update public.shift_requests r
       set status = 'cancelled', decided_at = now()
     where r.shift_id = v_shift.id and r.status = 'pending'
    returning r.requester_id
  )
  insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
  select c.requester_id, 'post_cancelled',
         format('%s shift no longer available', private.fmt_date(v_shift.date)),
         format('%s''s %s %s post was taken down by an admin, so your request was closed.',
                v_shift.poster_name, private.fmt_date(v_shift.date), v_shift.shift_type),
         '/trades', v_shift.id, v_admin.id
  from cancelled c;

  perform private.notify(
    v_shift.poster_id, 'post_cancelled',
    format('Your %s post was taken down', private.fmt_date(v_shift.date)),
    coalesce('An admin took down your post: ' || v_reason, 'An admin took down your post.'),
    '/trades', v_shift.id, v_admin.id);
  perform private.audit(v_admin.id, 'admin.post_cancelled', 'shift', v_shift.id,
    jsonb_build_object('reason', v_reason, 'poster_id', v_shift.poster_id));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_void_trade — undo a confirmed trade, even after it started (the
-- original then becomes cancelled instead of reopening). Either leg may be given.
-- Refused (ALREADY_COVERING, from private.undo_trade) when voiding would
-- double-book a member who has since picked up another shift on the day they
-- get back; the message names who and when, so that trade can be voided first.
-- -----------------------------------------------------------------------------
create or replace function public.admin_void_trade(p_shift_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_reason text := nullif(btrim(p_reason), '');
  v_orig public.shifts;
  v_leg public.shifts;
  v_reopened boolean;
  v_title text;
  v_body text;
begin
  if char_length(v_reason) > 500 then
    perform private.fail('Keep the reason under 500 characters.', 'INVALID_INPUT');
  end if;

  v_orig := private.lock_trade(p_shift_id);
  if v_orig.status <> 'covered' then
    perform private.fail('Only confirmed trades can be voided.', 'NOT_OPEN');
  end if;
  select * into v_leg from public.shifts s where s.id = v_orig.return_leg_id;

  v_reopened := private.undo_trade(v_orig, v_admin.id, coalesce(v_reason, 'Voided by an admin'));

  v_title := format('Trade voided: %s', private.fmt_date(v_orig.date));
  v_body := format('An admin voided the %s %s trade between %s and %s%s.%s%s',
    private.fmt_date(v_orig.date), v_orig.shift_type, v_orig.poster_name, v_orig.coverer_name,
    case when v_leg.id is not null then format(' (and the %s return shift)', private.fmt_date(v_leg.date)) else '' end,
    case when v_reason is not null then format(' Reason: "%s".', left(v_reason, 200)) else '' end,
    case when v_reopened then ' The shift is open on the board again.' else '' end);
  perform private.notify(v_orig.poster_id, 'trade_voided', v_title, v_body, '/trades/' || v_orig.id, v_orig.id, v_admin.id);
  perform private.notify(v_orig.coverer_id, 'trade_voided', v_title, v_body, '/trades/' || v_orig.id, v_orig.id, v_admin.id);

  perform private.audit(v_admin.id, 'admin.trade_voided', 'shift', v_orig.id, jsonb_build_object(
    'reason', v_reason, 'poster_id', v_orig.poster_id, 'coverer_id', v_orig.coverer_id,
    'return_leg_id', v_leg.id, 'reopened', v_reopened));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_overview — dashboard counts. trades_this_month = original legs
-- confirmed since the 1st of this month (Pacific) that are still covered.
-- -----------------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_month_start timestamptz :=
    (date_trunc('month', public.today_pt())::date + time '00:00') at time zone 'America/Los_Angeles';
begin
  return jsonb_build_object(
    'pending_members', (select count(*) from public.profiles p where p.status = 'pending'),
    'approved_members', (select count(*) from public.profiles p where p.status = 'approved'),
    'suspended_members', (select count(*) from public.profiles p where p.status = 'suspended'),
    'open_shifts', (select count(*) from public.shifts s where s.status = 'open' and s.starts_at > now()),
    'trades_this_month', (
      select count(*) from public.shifts s
      where s.status = 'covered' and s.return_leg_of is null and s.confirmed_at >= v_month_start),
    'roster_size', (select count(*) from public.roster),
    'roster_unclaimed', (select count(*) from public.roster r where r.claimed_by is null)
  );
end
$$;
