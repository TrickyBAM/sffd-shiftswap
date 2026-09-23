-- =============================================================================
-- 0004_internal_helpers.sql — building blocks shared by the RPCs: caller checks,
-- notifications, audit, the effective schedule (ARCHITECTURE §4), member stats,
-- request rules, trade locking/undo, new-shift fan-out (§6.5) and roster
-- matching (§6.4).
--
-- None of these are callable by API roles (see 0010_privileges.sql). They run
-- inside the SECURITY DEFINER RPCs, i.e. as the function owner.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Caller checks
-- -----------------------------------------------------------------------------

-- The signed-in caller's profile. Raises NOT_SIGNED_IN without a session and,
-- when p_require_approved (the default), NOT_APPROVED unless status = approved.
create or replace function private.require_member(p_require_approved boolean default true)
returns public.profiles
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
begin
  if v_uid is null then
    perform private.fail('Please sign in first.', 'NOT_SIGNED_IN');
  end if;

  select * into v_me from public.profiles p where p.id = v_uid;
  if not found then
    perform private.fail('We couldn''t find your member profile. Please sign out and sign in again.', 'NOT_SIGNED_IN');
  end if;

  if p_require_approved and v_me.status <> 'approved' then
    perform private.fail(
      case v_me.status
        when 'suspended' then 'Your account is suspended. Contact an admin if you think this is a mistake.'
        when 'rejected' then 'Your account wasn''t approved. Contact an admin if you think this is a mistake.'
        when 'onboarding' then 'Finish setting up your profile first.'
        else 'Your account is waiting for an admin to approve it.'
      end,
      'NOT_APPROVED'
    );
  end if;

  return v_me;
end
$$;

-- The caller's profile if they are an approved admin; NOT_ADMIN otherwise.
create or replace function private.require_admin()
returns public.profiles
language plpgsql
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
begin
  if v_me.role <> 'admin' then
    perform private.fail('Only admins can do that.', 'NOT_ADMIN');
  end if;
  return v_me;
end
$$;

-- -----------------------------------------------------------------------------
-- Audit log and notifications
-- -----------------------------------------------------------------------------
create or replace function private.audit(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_type, target_id, details)
  values (p_actor_id, p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function private.notify(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_url text,
  p_shift_id uuid,
  p_actor_id uuid
)
returns void
language sql
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
  values (p_user_id, p_type, p_title, p_body, coalesce(p_url, '/trades'), p_shift_id, p_actor_id)
$$;

-- One notification per approved admin (except the actor, if they are an admin).
create or replace function private.notify_admins(
  p_type text,
  p_title text,
  p_body text,
  p_url text,
  p_actor_id uuid
)
returns void
language sql
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, body, url, actor_id)
  select p.id, p_type, p_title, p_body, coalesce(p_url, '/admin'), p_actor_id
  from public.profiles p
  where p.role = 'admin'
    and p.status = 'approved'
    and p.id is distinct from p_actor_id
$$;

-- -----------------------------------------------------------------------------
-- Small lookups
-- -----------------------------------------------------------------------------

-- "Station 19" / "Airport Station 1".
create or replace function private.station_label(p_station int)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select s.label from public.stations s where s.station = p_station),
    'Station ' || p_station
  )
$$;

-- One {code, message} problem wrapped in a JSON array, for concatenation.
create or replace function private.problem(p_code text, p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object('code', p_code, 'message', p_message))
$$;

-- -----------------------------------------------------------------------------
-- Effective schedule (ARCHITECTURE §4)
--   base      = tour is not null and tour_works(tour, d)
--   givenAway = a covered shift with poster_id = u on d
--   pickedUp  = a covered shift with coverer_id = u on d
--   working   = (base and not givenAway) or pickedUp
-- SwapMatch return legs are ordinary covered rows, so they need no special case.
-- -----------------------------------------------------------------------------
create or replace function public.base_works(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select public.tour_works(p.tour, p_date) from public.profiles p where p.id = p_user_id),
    false
  )
$$;

create or replace function public.gave_away(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.shifts s
    where s.poster_id = p_user_id and s.date = p_date and s.status = 'covered'
  )
$$;

create or replace function public.picked_up(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.shifts s
    where s.coverer_id = p_user_id and s.date = p_date and s.status = 'covered'
  )
$$;

create or replace function public.effective_works(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (public.base_works(p_user_id, p_date) and not public.gave_away(p_user_id, p_date))
      or public.picked_up(p_user_id, p_date)
$$;

-- Has the member already posted (open) or given away (covered) that day?
create or replace function private.has_post(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.shifts s
    where s.poster_id = p_user_id and s.date = p_date and s.status in ('open', 'covered')
  )
$$;

-- Is the member still on the hook for their own shift that day? Either a tour
-- day they have not given away, or a day they have an open post for. The open
-- post matters for members with no tour: their posts are the only work days
-- the app knows about (post_shift and confirm_request already treat them as
-- working for SwapMatch return dates). Such a member must not also pick up
-- someone else's shift that day (request rules, new-shift alerts).
create or replace function private.works_own_shift(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (public.base_works(p_user_id, p_date) and not public.gave_away(p_user_id, p_date))
      or exists (
        select 1 from public.shifts s
        where s.poster_id = p_user_id and s.date = p_date and s.status = 'open'
      )
$$;

-- -----------------------------------------------------------------------------
-- Member statistics (my_stats / member_card, §6.3)
-- -----------------------------------------------------------------------------
create or replace function private.member_stats(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with t as (
    select
      count(*) filter (where s.poster_id = p_user_id and s.status <> 'cancelled' and s.return_leg_of is null) as posted,
      count(*) filter (where s.coverer_id = p_user_id and s.status = 'covered') as covered,
      count(*) filter (where s.poster_id = p_user_id and s.status = 'covered') as given,
      count(*) filter (where s.poster_id = p_user_id and s.status = 'open' and s.starts_at > pg_catalog.now()) as outstanding,
      -- open, not-started posts that have sat unanswered for more than a week
      count(*) filter (where s.poster_id = p_user_id and s.status = 'open' and s.starts_at > pg_catalog.now()
                         and s.created_at < pg_catalog.now() - interval '7 days') as stale,
      -- shifts I covered that started within the last 30 days
      count(*) filter (where s.coverer_id = p_user_id and s.status = 'covered' and s.starts_at <= pg_catalog.now()
                         and s.starts_at > pg_catalog.now() - interval '30 days') as recent,
      count(*) filter (where s.coverer_id = p_user_id and s.status = 'covered' and s.shift_type = '24-Hour') as covered_24,
      count(*) filter (where s.coverer_id = p_user_id and s.status = 'covered' and s.shift_type = 'PM') as covered_pm,
      count(*) filter (where s.poster_id = p_user_id and s.status = 'covered' and s.shift_type = '24-Hour') as given_24,
      count(*) filter (where s.poster_id = p_user_id and s.status = 'covered' and s.shift_type = 'PM') as given_pm
    from public.shifts s
    where s.poster_id = p_user_id or s.coverer_id = p_user_id
  )
  select jsonb_build_object(
    'posted', t.posted,
    'covered', t.covered,
    'given', t.given,
    'outstanding', t.outstanding,
    'balance', t.covered - t.given,
    'trust_score', greatest(0, least(100, 100 - 5 * t.stale + 3 * t.recent)),
    'by_type', jsonb_build_object(
      '24-Hour', jsonb_build_object('covered', t.covered_24, 'given', t.given_24, 'balance', t.covered_24 - t.given_24),
      'PM', jsonb_build_object('covered', t.covered_pm, 'given', t.given_pm, 'balance', t.covered_pm - t.given_pm)
    )
  )
  from t
$$;

-- -----------------------------------------------------------------------------
-- Request rules (request_shift / shift_eligibility / confirm_request, §6.3)
--
-- Returns every failing rule as [{code, message}] in a fixed order; the RPCs
-- raise the first one. p_confirming = true re-validates an existing request
-- for the poster (skips ALREADY_REQUESTED, words messages for the poster).
-- -----------------------------------------------------------------------------
create or replace function private.request_problems(
  p_shift public.shifts,
  p_requester public.profiles,
  p_return_date date,
  p_confirming boolean default false
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems jsonb := '[]'::jsonb;
  v_name text := coalesce(nullif(p_requester.full_name, ''), 'This member');
  v_day text := private.fmt_date(p_shift.date);
  v_rd text := private.fmt_date(p_return_date);
  v_limit_label text;
  v_within boolean;
begin
  if p_shift.poster_id = p_requester.id then
    v_problems := v_problems || private.problem('OWN_SHIFT', 'This is your own shift.');
  end if;

  if p_shift.status <> 'open' then
    v_problems := v_problems || private.problem('NOT_OPEN', 'This shift is no longer open.');
  elsif not exists (
    select 1 from public.profiles p where p.id = p_shift.poster_id and p.status = 'approved'
  ) then
    -- A post is only available while its poster is an active member. Suspending
    -- a member takes their upcoming posts down (admin_set_member_status); this
    -- also covers any post left behind, so nobody can request it (and so read
    -- the poster's contact details through get_trade_contact).
    v_problems := v_problems || private.problem('NOT_OPEN', 'This shift is no longer available.');
  end if;

  if p_shift.starts_at <= pg_catalog.now() then
    v_problems := v_problems || private.problem('STARTED', 'This shift has already started.');
  end if;

  if p_requester.rank is distinct from p_shift.rank then
    v_problems := v_problems || private.problem('RANK_MISMATCH',
      case when p_confirming
        then pg_catalog.format('%s is no longer %s rank. Trades are same rank only.', v_name, p_shift.rank)
        else pg_catalog.format('This shift is for %s rank only.', p_shift.rank)
      end);
  end if;

  v_within := case p_shift.accept_limit
    when 'station' then p_requester.station is not distinct from p_shift.station
    when 'battalion' then p_requester.battalion is not distinct from p_shift.battalion
    when 'division' then p_requester.division is not distinct from p_shift.division
    else true
  end;
  if not v_within then
    v_limit_label := case p_shift.accept_limit
      when 'station' then private.station_label(p_shift.station)
      when 'battalion' then 'Battalion ' || p_shift.battalion
      else 'Division ' || p_shift.division
    end;
    v_problems := v_problems || private.problem('OUTSIDE_LIMIT',
      case when p_confirming
        then pg_catalog.format('%s is outside the limit you set (%s members only).', v_name, v_limit_label)
        else pg_catalog.format('The poster limited this shift to %s members.', v_limit_label)
      end);
  end if;

  -- Working that day: a tour day not given away, or (members with no tour
  -- included) a day they have an open post for.
  if private.works_own_shift(p_requester.id, p_shift.date) then
    v_problems := v_problems || private.problem('YOU_WORK_THAT_DAY',
      case when p_confirming
        then pg_catalog.format('%s is working on %s.', v_name, v_day)
        else pg_catalog.format('You''re working on %s.', v_day)
      end);
  end if;

  if public.picked_up(p_requester.id, p_shift.date) then
    v_problems := v_problems || private.problem('ALREADY_COVERING',
      case when p_confirming
        then pg_catalog.format('%s is already covering a shift on %s.', v_name, v_day)
        else pg_catalog.format('You''re already covering a shift on %s.', v_day)
      end);
  end if;

  if not p_confirming and exists (
    select 1 from public.shift_requests r
    where r.shift_id = p_shift.id and r.requester_id = p_requester.id and r.status = 'pending'
  ) then
    v_problems := v_problems || private.problem('ALREADY_REQUESTED', 'You already have a request waiting on this shift.');
  end if;

  if cardinality(p_shift.return_dates) > 0 then
    -- SwapMatch: the requester must pick one of the offered return dates.
    if p_return_date is null then
      v_problems := v_problems || private.problem('RETURN_DATE_REQUIRED',
        'This is a SwapMatch. Pick the date you want the poster to work for you.');
    elsif not (p_return_date = any (p_shift.return_dates)) then
      v_problems := v_problems || private.problem('RETURN_DATE_INVALID',
        'Pick one of the return dates the poster offered.');
    elsif public.shift_starts_at(p_return_date, p_shift.shift_type) <= pg_catalog.now() then
      v_problems := v_problems || private.problem('RETURN_DATE_INVALID',
        pg_catalog.format('The return date %s has already passed.', v_rd));
    else
      -- The return date must be the requester's own shift to give: their tour
      -- day (when they have a tour), not already posted/given away, and not a
      -- day they picked up from someone else.
      if (p_requester.tour is not null and not public.tour_works(p_requester.tour, p_return_date))
         or private.has_post(p_requester.id, p_return_date)
         or public.picked_up(p_requester.id, p_return_date) then
        v_problems := v_problems || private.problem('RETURN_NOT_YOUR_DAY',
          case when p_confirming
            then pg_catalog.format('%s no longer has %s free to give you.', v_name, v_rd)
            else pg_catalog.format('%s isn''t one of your own shifts to give (it must be your tour day and not already traded).', v_rd)
          end);
      end if;
      -- …and the poster must still be off that day with nothing posted.
      if public.effective_works(p_shift.poster_id, p_return_date) or private.has_post(p_shift.poster_id, p_return_date) then
        v_problems := v_problems || private.problem('POSTER_WORKS_RETURN_DAY',
          case when p_confirming
            then pg_catalog.format('You''re working on %s, so you can''t take that return date.', v_rd)
            else pg_catalog.format('The poster is now working on %s. Pick another return date.', v_rd)
          end);
      end if;
    end if;
  elsif p_return_date is not null then
    v_problems := v_problems || private.problem('RETURN_DATE_INVALID',
      'This shift isn''t a SwapMatch, so there is no return date to pick.');
  end if;

  return v_problems;
end
$$;

-- -----------------------------------------------------------------------------
-- Trades
-- -----------------------------------------------------------------------------

-- Resolve either leg of a trade to its original leg and lock both legs
-- (FOR UPDATE). NOT_FOUND for an unknown id; NOT_OPEN for a return leg that no
-- longer belongs to its original (the trade it was part of is over).
create or replace function private.lock_trade(p_shift_id uuid)
returns public.shifts
language plpgsql
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_orig public.shifts;
begin
  select * into v_shift from public.shifts s where s.id = p_shift_id;
  if not found then
    perform private.fail('That trade no longer exists.', 'NOT_FOUND');
  end if;

  select * into v_orig
  from public.shifts s
  where s.id = coalesce(v_shift.return_leg_of, v_shift.id)
  for update;

  if v_shift.return_leg_of is not null and v_orig.return_leg_id is distinct from v_shift.id then
    perform private.fail('This trade is no longer active.', 'NOT_OPEN');
  end if;

  if v_orig.return_leg_id is not null then
    perform 1 from public.shifts s where s.id = v_orig.return_leg_id for update;
  end if;

  return v_orig;
end
$$;

-- Would undoing this trade double-book either member? Undoing hands each
-- member their own shift back: the poster gets the original date (reopened as
-- an open post, or theirs to work once it started), and in a SwapMatch the
-- requester gets the return date. If that member has since picked up someone
-- else's shift on that day, they would be on the hook for two shifts at once,
-- so the other trade has to be undone first. Neither check can see this
-- trade's own legs (the return date is never the original date).
-- With p_viewer_only, only a conflict of p_viewer_id's own counts.
-- Returns a friendly message (worded for p_viewer_id), or null when it is safe.
create or replace function private.undo_trade_conflict(
  p_orig public.shifts,
  p_viewer_id uuid,
  p_viewer_only boolean default false
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_leg_date date;
  r record;
begin
  if p_orig.return_leg_id is not null then
    select s.date into v_leg_date from public.shifts s where s.id = p_orig.return_leg_id;
  end if;

  for r in
    select v.member_id, v.member_name, v.day
    from (values
      (p_orig.poster_id, p_orig.poster_name, p_orig.date),   -- poster gets the original date back
      (p_orig.coverer_id, p_orig.coverer_name, v_leg_date)   -- requester gets the return date back
    ) as v(member_id, member_name, day)
  loop
    continue when r.day is null or r.member_id is null;
    continue when p_viewer_only and r.member_id is distinct from p_viewer_id;
    if public.picked_up(r.member_id, r.day) then
      if r.member_id = p_viewer_id then
        return pg_catalog.format(
          'You''re covering another shift on %s. Cancelling this trade would give you back your own shift that day too, so cancel that other trade first.',
          private.fmt_date(r.day));
      end if;
      return pg_catalog.format(
        '%s is covering another shift on %s. Cancelling this trade would give them back their own shift that day too, so that other trade has to be cancelled first.',
        coalesce(nullif(r.member_name, ''), 'The other member'), private.fmt_date(r.day));
    end if;
  end loop;
  return null;
end
$$;

-- Undo a confirmed trade (agreed cancel or admin void). The original leg goes
-- back to open when it has not started, otherwise it is cancelled; a SwapMatch
-- return leg is always cancelled; the accepted request becomes cancelled.
-- Refused (ALREADY_COVERING) when it would double-book either member, see
-- undo_trade_conflict. Returns true when the original was reopened. Caller
-- must hold the locks (private.lock_trade).
create or replace function private.undo_trade(p_orig public.shifts, p_actor_id uuid, p_note text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_reopen boolean := p_orig.starts_at > pg_catalog.now();
  v_conflict text := private.undo_trade_conflict(p_orig, p_actor_id);
begin
  if v_conflict is not null then
    perform private.fail(v_conflict, 'ALREADY_COVERING');
  end if;

  if p_orig.return_leg_id is not null then
    update public.shifts s
       set status = 'cancelled',
           coverer_id = null,
           cancelled_at = pg_catalog.now(),
           cancelled_by = p_actor_id,
           cancel_note = p_note,
           cancel_requested_by = null,
           cancel_requested_at = null,
           cancel_reason = null
     where s.id = p_orig.return_leg_id;
  end if;

  if v_reopen then
    update public.shifts s
       set status = 'open',
           coverer_id = null,
           coverer_name = null,
           confirmed_at = null,
           return_leg_id = null,
           cancel_requested_by = null,
           cancel_requested_at = null,
           cancel_reason = null
     where s.id = p_orig.id;
  else
    -- coverer_name / confirmed_at are kept on a cancelled leg for history.
    update public.shifts s
       set status = 'cancelled',
           coverer_id = null,
           cancelled_at = pg_catalog.now(),
           cancelled_by = p_actor_id,
           cancel_note = p_note,
           cancel_requested_by = null,
           cancel_requested_at = null,
           cancel_reason = null
     where s.id = p_orig.id;
  end if;

  update public.shift_requests r
     set status = 'cancelled', decided_at = pg_catalog.now()
   where r.shift_id = p_orig.id and r.status = 'accepted';

  return v_reopen;
end
$$;

-- -----------------------------------------------------------------------------
-- New-shift fan-out (§6.5): a `new_shift` notification for every approved
-- member who is not the poster, has the same rank, wants alerts for the shift's
-- location (notify_scope relative to their own station), satisfies the shift's
-- accept_limit, and is free that day by the same rules request_shift applies
-- (YOU_WORK_THAT_DAY, ALREADY_COVERING): not on their own shift (a tour day
-- not given away, or an open post of their own — which is how members with no
-- tour show a work day) and not covering anyone.
-- -----------------------------------------------------------------------------
create or replace function private.fan_out_new_shift(p_shift_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
  select
    m.id,
    'new_shift',
    pg_catalog.format('New %s shift · %s', s.shift_type, private.fmt_date(s.date)),
    pg_catalog.format('%s · %s · posted by %s%s', st.label, s.rank, s.poster_name,
      case when cardinality(s.return_dates) > 0 then ' · SwapMatch' else '' end),
    '/board?shift=' || s.id,
    s.id,
    s.poster_id
  from public.shifts s
  join public.stations st on st.station = s.station
  join public.profiles m
    on m.status = 'approved'
   and m.id <> s.poster_id
   and m.rank = s.rank
   and m.notify_scope <> 'off'
  where s.id = p_shift_id
    and case m.notify_scope
          when 'station' then m.station = s.station
          when 'battalion' then m.battalion = s.battalion
          when 'division' then m.division = s.division
          when 'all' then true
          else false
        end
    and case s.accept_limit
          when 'anyone' then true
          when 'division' then m.division = s.division
          when 'battalion' then m.battalion = s.battalion
          when 'station' then m.station = s.station
          else false
        end
    and not private.works_own_shift(m.id, s.date)
    and not public.picked_up(m.id, s.date);

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- Roster matching (§6.4)
--
-- 1. Name forms tried: "First … Last" (first token / last token, trailing
--    Jr/Sr/II/III/IV/V dropped; for 3+ tokens also everything after the first
--    token as a compound last name, e.g. "Maria De La Cruz"), and when there is
--    a comma, "Last, First …".
-- 2. Candidates: unclaimed roster rows with the same last_key and the same
--    first_key, or a single-initial roster first name equal to the applicant's
--    first initial.
-- 3. Exactly one candidate is required. Every attribute that row has is compared
--    (employee_id and email case-insensitively). Any difference ⇒ no
--    auto-approve — and an employee ID the applicant left blank counts as a
--    difference when the roster row has one: rank and station are easy to know
--    about a colleague, the employee ID is not.
-- 4. Auto-approve iff nothing differs and (≥ 2 attributes match or the
--    employee_id matches).
-- Returns {auto_approve, roster_id, reason, candidates, matches, differences}.
-- `reason` names the roster candidate and what differs. It is roster data, so
-- it is for admins only (audit_log, admin notifications) and must never be
-- stored where the applicant can read it (profiles.status_reason).
-- -----------------------------------------------------------------------------
create or replace function private.name_tokens(p_text text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.regexp_split_to_array(private.clean_name(pg_catalog.replace(p_text, ',', ' ')), ' '),
    '{}'::text[]
  )
$$;

-- Drop generational suffixes from the end while more than p_keep tokens remain.
create or replace function private.drop_name_suffixes(p_tokens text[], p_keep int)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tokens text[] := coalesce(p_tokens, '{}'::text[]);
  v_n int := coalesce(array_length(p_tokens, 1), 0);
begin
  while v_n > p_keep
    and public.name_key(v_tokens[v_n]) = any (array['jr', 'sr', 'ii', 'iii', 'iv', 'v']) loop
    v_n := v_n - 1;
  end loop;
  return v_tokens[1:v_n];
end
$$;

create or replace function private.roster_match(
  p_full_name text,
  p_employee_id text,
  p_rank text,
  p_station int,
  p_tour smallint,
  p_email text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_name text := private.clean_name(p_full_name);
  v_comma int;
  v_last_part text[];
  v_rest text[];
  v_tokens text[];
  v_n int;
  v_firsts text[] := '{}';
  v_lasts text[] := '{}';
  v_ids uuid[];
  v_row public.roster;
  v_matches int := 0;
  v_emp_match boolean := false;
  v_diffs text[] := '{}';
  v_label text;
  v_auto boolean;
  v_reason text;
begin
  if v_name is null then
    return jsonb_build_object('auto_approve', false, 'roster_id', null, 'candidates', 0,
      'reason', 'Roster: no name to match');
  end if;

  -- "Last, First Middle"
  v_comma := strpos(v_name, ',');
  if v_comma > 0 then
    v_last_part := private.drop_name_suffixes(private.name_tokens(substr(v_name, 1, v_comma - 1)), 1);
    v_rest := private.name_tokens(substr(v_name, v_comma + 1));
    -- tolerate "Smith, Jr., John" and "Smith, John, Jr."
    while coalesce(array_length(v_rest, 1), 0) > 1
      and public.name_key(v_rest[1]) = any (array['jr', 'sr', 'ii', 'iii', 'iv', 'v']) loop
      v_rest := v_rest[2:];
    end loop;
    if coalesce(array_length(v_rest, 1), 0) >= 1 and coalesce(array_length(v_last_part, 1), 0) >= 1 then
      v_firsts := v_firsts || public.name_key(v_rest[1]);
      v_lasts := v_lasts || public.name_key(array_to_string(v_last_part, ' '));
    end if;
  end if;

  -- "First … Last"
  v_tokens := private.drop_name_suffixes(private.name_tokens(v_name), 2);
  v_n := coalesce(array_length(v_tokens, 1), 0);
  if v_n >= 2 then
    v_firsts := v_firsts || public.name_key(v_tokens[1]);
    v_lasts := v_lasts || public.name_key(v_tokens[v_n]);
    if v_n > 2 then
      v_firsts := v_firsts || public.name_key(v_tokens[1]);
      v_lasts := v_lasts || public.name_key(array_to_string(v_tokens[2:v_n], ' '));
    end if;
  end if;

  select coalesce(array_agg(distinct r.id), '{}'::uuid[]) into v_ids
  from public.roster r
  join unnest(v_firsts, v_lasts) as k(first_key, last_key)
    on k.first_key <> '' and k.last_key <> ''
   and r.last_key = k.last_key
   and (r.first_key = k.first_key
        or (char_length(r.first_key) = 1 and r.first_key = left(k.first_key, 1)))
  where r.claimed_by is null;

  if cardinality(v_ids) = 0 then
    if exists (
      select 1 from public.roster r
      join unnest(v_firsts, v_lasts) as k(first_key, last_key)
        on k.first_key <> '' and k.last_key <> ''
       and r.last_key = k.last_key
       and (r.first_key = k.first_key
            or (char_length(r.first_key) = 1 and r.first_key = left(k.first_key, 1)))
      where r.claimed_by is not null
    ) then
      v_reason := pg_catalog.format('Roster: %s is already linked to another account', v_name);
    else
      v_reason := pg_catalog.format('Roster: no entry found for %s', v_name);
    end if;
    return jsonb_build_object('auto_approve', false, 'roster_id', null, 'candidates', 0, 'reason', v_reason);
  end if;

  if cardinality(v_ids) > 1 then
    return jsonb_build_object('auto_approve', false, 'roster_id', null, 'candidates', cardinality(v_ids),
      'reason', pg_catalog.format('Roster: %s entries match %s. Pick the right one when approving', cardinality(v_ids), v_name));
  end if;

  select * into v_row from public.roster r where r.id = v_ids[1];

  if v_row.employee_id is not null then
    if nullif(btrim(p_employee_id), '') is null then
      v_diffs := array_append(v_diffs, 'employee ID (not entered)');
    elsif lower(btrim(v_row.employee_id)) = lower(btrim(p_employee_id)) then
      v_matches := v_matches + 1;
      v_emp_match := true;
    else
      v_diffs := array_append(v_diffs, 'employee ID');
    end if;
  end if;

  if v_row.rank is not null then
    if v_row.rank = p_rank then v_matches := v_matches + 1; else v_diffs := array_append(v_diffs, 'rank'); end if;
  end if;

  if v_row.station is not null then
    if v_row.station = p_station then v_matches := v_matches + 1; else v_diffs := array_append(v_diffs, 'station'); end if;
  end if;

  if v_row.tour is not null then
    if v_row.tour = p_tour then v_matches := v_matches + 1; else v_diffs := array_append(v_diffs, 'tour'); end if;
  end if;

  if nullif(btrim(v_row.email), '') is not null then
    if lower(btrim(v_row.email)) = lower(btrim(coalesce(p_email, ''))) then
      v_matches := v_matches + 1;
    else
      v_diffs := array_append(v_diffs, 'email');
    end if;
  end if;

  v_auto := cardinality(v_diffs) = 0 and (v_matches >= 2 or v_emp_match);
  v_label := v_row.first_name || ' ' || v_row.last_name
    || coalesce(', ' || private.station_label(v_row.station), '');
  v_reason := case
    when cardinality(v_diffs) > 0 then
      pg_catalog.format('Roster: %s — %s %s', v_label, array_to_string(v_diffs, ', '),
        case when cardinality(v_diffs) = 1 then 'differs' else 'differ' end)
    when v_auto then pg_catalog.format('Roster: %s — matched', v_label)
    when v_matches = 0 then pg_catalog.format('Roster: %s — no details to compare', v_label)
    else pg_catalog.format('Roster: %s — only 1 detail matches', v_label)
  end;

  return jsonb_build_object(
    'auto_approve', v_auto,
    'roster_id', v_row.id,
    'candidates', 1,
    'matches', v_matches,
    'differences', to_jsonb(v_diffs),
    'reason', v_reason
  );
end
$$;
