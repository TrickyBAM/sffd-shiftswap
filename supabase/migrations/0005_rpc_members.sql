-- =============================================================================
-- 0005_rpc_members.sql — onboarding & profile RPCs (ARCHITECTURE §6.3, §6.4).
-- All SECURITY DEFINER with an empty search_path; EXECUTE is granted in
-- 0010_privileges.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- complete_onboarding — first-time profile (or an edit while still pending),
-- then roster matching: a roster match auto-approves, otherwise the member is
-- pending and admins are notified with their contact details.
--
-- The roster is admin-only (§6.2), and so is everything roster matching learns
-- about the candidate row (its station, which details differ, whether the name
-- is on the roster or already claimed). None of it goes to the applicant: they
-- only learn approved or pending, and profiles.status_reason stays null while
-- pending (it is for the reason an admin gives when rejecting or suspending).
-- The roster note for admins is kept in the `member.pending` audit entry
-- (details.roster_note, details.roster_id = the candidate row, if any) and in
-- the `member_pending` notice admins get.
--
-- Guessing is capped: roster matching may auto-approve only on the first
-- 3 submissions of an account (the first attempt plus two corrections). After
-- that the member stays pending until an admin approves them, which keeps
-- someone who only knows a colleague's name from trying rank × station × tour
-- until one sticks.
-- -----------------------------------------------------------------------------
create or replace function public.complete_onboarding(
  p_full_name text,
  p_phone text,
  p_rank text,
  p_station int,
  p_tour int,
  p_employee_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_name text := private.clean_name(p_full_name);
  v_phone text := btrim(p_phone);
  v_emp text := nullif(btrim(p_employee_id), '');
  v_station public.stations;
  v_match jsonb;
  v_note text;
  v_roster_id uuid;
  v_tries int;                          -- earlier submissions that ended pending
  v_capped boolean;
  c_max_tries constant int := 3;        -- submissions that may auto-approve
begin
  if v_uid is null then
    perform private.fail('Please sign in first.', 'NOT_SIGNED_IN');
  end if;

  select * into v_me from public.profiles p where p.id = v_uid for update;
  if not found then
    perform private.fail('We couldn''t find your member profile. Please sign out and sign in again.', 'NOT_SIGNED_IN');
  end if;
  if v_me.status = 'approved' then
    perform private.fail('Your profile is already set up. You can edit it from the Profile page.', 'INVALID_INPUT');
  end if;
  if v_me.status not in ('onboarding', 'pending') then
    perform private.fail('Your account isn''t active. Contact an admin if you think this is a mistake.', 'NOT_APPROVED');
  end if;

  -- Validate
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    perform private.fail('Enter your full name (2 to 80 characters).', 'INVALID_INPUT');
  end if;
  if not private.valid_phone(v_phone) then
    perform private.fail('Enter a phone number members can reach you at (7 to 20 digits, spaces, +, -, or parentheses).', 'INVALID_INPUT');
  end if;
  if p_rank is null or not (p_rank = any (private.ranks())) then
    perform private.fail('Choose your rank.', 'INVALID_INPUT');
  end if;
  select * into v_station from public.stations s where s.station = p_station;
  if not found then
    perform private.fail('Choose your station.', 'INVALID_INPUT');
  end if;
  if p_tour is not null and (p_tour < 1 or p_tour > 31) then
    perform private.fail('Tour must be between 1 and 31, or No tour.', 'INVALID_INPUT');
  end if;
  if char_length(v_emp) > 40 then
    perform private.fail('Employee ID is too long.', 'INVALID_INPUT');
  end if;

  update public.profiles p
     set full_name = v_name,
         phone = v_phone,
         rank = p_rank,
         station = v_station.station,
         battalion = v_station.battalion,
         division = v_station.division,
         tour = p_tour,
         employee_id = v_emp
   where p.id = v_uid;

  -- Roster matching (§6.4). Every submission that ends pending is audited as
  -- member.pending, so those entries count the tries (the profile row is
  -- locked above, so concurrent submissions are counted one after another).
  select count(*)::int into v_tries
  from public.audit_log a
  where a.target_type = 'profile' and a.target_id = v_uid and a.action = 'member.pending';
  v_capped := v_tries >= c_max_tries;

  v_match := private.roster_match(v_name, v_emp, p_rank, v_station.station, p_tour::smallint, v_me.email);
  v_note := v_match ->> 'reason';

  -- The claim is conditional so a roster row can only ever be claimed once,
  -- even under concurrency.
  if (v_match ->> 'auto_approve')::boolean and not v_capped then
    update public.roster r
       set claimed_by = v_uid
     where r.id = (v_match ->> 'roster_id')::uuid and r.claimed_by is null
    returning r.id into v_roster_id;
  end if;

  if v_roster_id is not null then
    update public.profiles p
       set status = 'approved',
           status_reason = null,
           roster_id = v_roster_id,
           approved_at = now(),
           approved_by = null
     where p.id = v_uid;

    perform private.notify_admins(
      'member_auto_approved',
      'New member auto-approved',
      format('%s (%s, %s) matched the roster and was approved.', v_name, p_rank, v_station.label),
      '/admin/members',
      v_uid
    );
    perform private.audit(v_uid, 'member.auto_approved', 'profile', v_uid,
      jsonb_build_object('roster_id', v_roster_id, 'rank', p_rank, 'station', v_station.station, 'tour', p_tour));

    return jsonb_build_object(
      'status', 'approved',
      'matched', true,
      'message', 'You matched the department roster and you''re approved. Welcome to ShiftSwap!'
    );
  end if;

  if v_capped then
    v_note := v_note || case
      when (v_match ->> 'auto_approve')::boolean
        then format(' — but not auto-approved: this account already had %s tries, so check it really is them', v_tries)
      else format(' (auto-approval is off after %s tries)', c_max_tries)
    end;
  elsif (v_match ->> 'auto_approve')::boolean then
    -- Matched, but another account claimed the row at the same moment.
    v_note := v_note || ' — but the entry was just linked to another account';
  end if;

  -- status_reason is shown to the member, so it gets nothing from the roster.
  update public.profiles p
     set status = 'pending',
         status_reason = null
   where p.id = v_uid;

  -- Admins hear about an applicant once; later edits while pending show up in
  -- the admin Approvals list (latest member.pending audit entry).
  if v_me.status = 'onboarding' then
    perform private.notify_admins(
      'member_pending',
      'Member waiting for approval',
      format('%s · %s · %s · %s · %s · %s', v_name, p_rank, v_station.label, v_phone,
        coalesce(nullif(v_me.email, ''), 'no email'), v_note),
      '/admin',
      v_uid
    );
  end if;
  perform private.audit(v_uid, 'member.pending', 'profile', v_uid, jsonb_build_object(
    'roster_note', v_note,
    'roster_id', v_match -> 'roster_id',
    'attempt', v_tries + 1,
    'auto_approve_blocked', v_capped,
    'rank', p_rank, 'station', v_station.station, 'tour', p_tour));

  return jsonb_build_object(
    'status', 'pending',
    'matched', false,
    'message', 'Thanks! We couldn''t match you to the department roster automatically, so an admin will review your account. You''ll be able to trade once you''re approved.'
  );
end
$$;

-- -----------------------------------------------------------------------------
-- acknowledge_telestaff — the one-time "TeleStaff is the official system" notice.
-- The first acknowledgment time is kept.
-- -----------------------------------------------------------------------------
create or replace function public.acknowledge_telestaff()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
begin
  if v_me.telestaff_ack_at is null then
    update public.profiles p set telestaff_ack_at = now() where p.id = v_me.id;
    perform private.audit(v_me.id, 'member.telestaff_acknowledged', 'profile', v_me.id, '{}'::jsonb);
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- update_my_profile — phone, station, tour (null = no tour) and new-shift alert
-- scope. Name, rank and employee ID are admin-only (admin_update_member).
-- -----------------------------------------------------------------------------
create or replace function public.update_my_profile(
  p_phone text,
  p_station int,
  p_tour int,
  p_notify_scope text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_phone text := btrim(p_phone);
  v_station public.stations;
begin
  if not private.valid_phone(v_phone) then
    perform private.fail('Enter a phone number members can reach you at (7 to 20 digits, spaces, +, -, or parentheses).', 'INVALID_INPUT');
  end if;
  select * into v_station from public.stations s where s.station = p_station;
  if not found then
    perform private.fail('Choose your station.', 'INVALID_INPUT');
  end if;
  if p_tour is not null and (p_tour < 1 or p_tour > 31) then
    perform private.fail('Tour must be between 1 and 31, or No tour.', 'INVALID_INPUT');
  end if;
  if p_notify_scope is null or p_notify_scope not in ('off', 'station', 'battalion', 'division', 'all') then
    perform private.fail('Choose which new shifts you want alerts for.', 'INVALID_INPUT');
  end if;

  update public.profiles p
     set phone = v_phone,
         station = v_station.station,
         battalion = v_station.battalion,
         division = v_station.division,
         tour = p_tour,
         notify_scope = p_notify_scope
   where p.id = v_me.id;

  if v_me.station is distinct from v_station.station or v_me.tour is distinct from p_tour::smallint then
    perform private.audit(v_me.id, 'member.profile_updated', 'profile', v_me.id,
      jsonb_build_object(
        'station', jsonb_build_object('from', v_me.station, 'to', v_station.station),
        'tour', jsonb_build_object('from', v_me.tour, 'to', p_tour)
      ));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- clear_must_change_password — called after the forced password change. Any
-- signed-in member (the flag may be set on accounts that are not approved yet).
-- -----------------------------------------------------------------------------
create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(false);
begin
  update public.profiles p set must_change_password = false where p.id = v_me.id;
end
$$;

-- -----------------------------------------------------------------------------
-- regenerate_calendar_token — invalidates the old calendar subscription URL.
-- -----------------------------------------------------------------------------
create or replace function public.regenerate_calendar_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_token uuid;
begin
  update public.profiles p
     set calendar_token = gen_random_uuid()
   where p.id = v_me.id
  returning p.calendar_token into v_token;
  return v_token;
end
$$;

-- -----------------------------------------------------------------------------
-- my_stats — {posted, covered, given, outstanding, balance, trust_score, by_type}
-- -----------------------------------------------------------------------------
create or replace function public.my_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
begin
  return private.member_stats(v_me.id);
end
$$;

-- -----------------------------------------------------------------------------
-- my_ledger — per trade partner and shift type: who covered whom.
-- net = I covered − they covered (positive ⇒ they owe me). Covered shifts only
-- (both SwapMatch legs count, so a swap nets to zero).
-- -----------------------------------------------------------------------------
create or replace function public.my_ledger()
returns table (
  partner_id uuid,
  partner_name text,
  partner_rank text,
  i_covered_24 int,
  i_covered_pm int,
  they_covered_24 int,
  they_covered_pm int,
  net_24 int,
  net_pm int,
  upcoming int,
  last_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me public.profiles := private.require_member(true);
begin
  return query
  with legs as (
    select
      case when s.coverer_id = v_me.id then s.poster_id else s.coverer_id end as partner,
      (s.coverer_id = v_me.id) as i_covered,
      s.shift_type,
      s.date,
      s.starts_at
    from public.shifts s
    where s.status = 'covered'
      and (s.poster_id = v_me.id or s.coverer_id = v_me.id)
  )
  select
    l.partner,
    p.full_name,
    p.rank,
    (count(*) filter (where l.i_covered and l.shift_type = '24-Hour'))::int,
    (count(*) filter (where l.i_covered and l.shift_type = 'PM'))::int,
    (count(*) filter (where not l.i_covered and l.shift_type = '24-Hour'))::int,
    (count(*) filter (where not l.i_covered and l.shift_type = 'PM'))::int,
    (count(*) filter (where l.i_covered and l.shift_type = '24-Hour')
      - count(*) filter (where not l.i_covered and l.shift_type = '24-Hour'))::int,
    (count(*) filter (where l.i_covered and l.shift_type = 'PM')
      - count(*) filter (where not l.i_covered and l.shift_type = 'PM'))::int,
    (count(*) filter (where l.starts_at > now()))::int,
    max(l.date)
  from legs l
  join public.profiles p on p.id = l.partner
  group by l.partner, p.full_name, p.rank
  order by 11 desc, 2;
end
$$;

-- -----------------------------------------------------------------------------
-- my_schedule — the caller's effective schedule, one row per day (≤ 400 days).
-- -----------------------------------------------------------------------------
create or replace function public.my_schedule(p_from date, p_to date)
returns table (
  date date,
  base boolean,
  given_away boolean,
  picked_up boolean,
  working boolean,
  open_post_id uuid,
  given_shift_id uuid,
  picked_shift_id uuid,
  is_swap boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me public.profiles := private.require_member(true);
begin
  if p_from is null or p_to is null or p_to < p_from then
    perform private.fail('Choose a valid date range.', 'INVALID_INPUT');
  end if;
  if p_to - p_from + 1 > 400 then
    perform private.fail('Choose a date range of at most 400 days.', 'INVALID_INPUT');
  end if;

  return query
  with days as (
    select p_from + i as day
    from generate_series(0, p_to - p_from) as g(i)
  )
  select
    d.day,
    public.tour_works(v_me.tour, d.day),
    g.id is not null,
    k.id is not null,
    (public.tour_works(v_me.tour, d.day) and g.id is null) or k.id is not null,
    o.id,
    g.id,
    k.id,
    coalesce(g.return_leg_of is not null or g.return_leg_id is not null, false)
      or coalesce(k.return_leg_of is not null or k.return_leg_id is not null, false)
  from days d
  left join public.shifts g
    on g.poster_id = v_me.id and g.date = d.day and g.status = 'covered'
  left join public.shifts k
    on k.coverer_id = v_me.id and k.date = d.day and k.status = 'covered'
  left join public.shifts o
    on o.poster_id = v_me.id and o.date = d.day and o.status = 'open'
  order by 1;
end
$$;

-- -----------------------------------------------------------------------------
-- get_trade_contact — the other party's contact details, only for trade
-- partners: the poster sees the coverer and every requester with a pending or
-- accepted request; a requester (pending/accepted) or the coverer sees the
-- poster. Anyone else gets no rows.
-- -----------------------------------------------------------------------------
create or replace function public.get_trade_contact(p_shift_id uuid)
returns table (
  user_id uuid,
  full_name text,
  rank text,
  station int,
  phone text,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me public.profiles := private.require_member(true);
  v_shift public.shifts;
begin
  select * into v_shift from public.shifts s where s.id = p_shift_id;
  if not found then
    perform private.fail('That shift no longer exists.', 'NOT_FOUND');
  end if;

  return query
  select p.id, p.full_name, p.rank, p.station, p.phone, p.email
  from public.profiles p
  where p.id <> v_me.id
    and (
      -- I'm the poster: my coverer and my (pending/accepted) requesters
      (v_shift.poster_id = v_me.id and (
        p.id = v_shift.coverer_id
        or exists (
          select 1 from public.shift_requests r
          where r.shift_id = v_shift.id and r.requester_id = p.id and r.status in ('pending', 'accepted')
        )
      ))
      -- I'm the coverer or a requester: the poster
      or (p.id = v_shift.poster_id and (
        v_shift.coverer_id = v_me.id
        or exists (
          select 1 from public.shift_requests r
          where r.shift_id = v_shift.id and r.requester_id = v_me.id and r.status in ('pending', 'accepted')
        )
      ))
    )
  order by p.full_name;
end
$$;

-- -----------------------------------------------------------------------------
-- member_card — public-to-members summary of an approved member (no contact
-- details), used by posters to choose between requests.
-- -----------------------------------------------------------------------------
create or replace function public.member_card(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_member public.profiles;
  v_stats jsonb;
begin
  select * into v_member from public.profiles p where p.id = p_user_id and p.status = 'approved';
  if not found then
    perform private.fail('That member wasn''t found.', 'NOT_FOUND');
  end if;
  v_stats := private.member_stats(v_member.id);
  return jsonb_build_object(
    'full_name', v_member.full_name,
    'rank', v_member.rank,
    'station', v_member.station,
    'battalion', v_member.battalion,
    'trust_score', v_stats -> 'trust_score',
    'covered', v_stats -> 'covered',
    'given', v_stats -> 'given'
  );
end
$$;
