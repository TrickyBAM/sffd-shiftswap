-- =============================================================================
-- 0011_v1_review_fixes.sql — database fixes from the v1 multi-lens review.
--
-- 0001–0010 are already applied to production, so every change lives here
-- (create or replace / alter). Sections:
--   1. Accounts can only be created by the app (SEC-6)
--   2. profiles.removed_at (CC-4, used by section 8)
--   3. Effective schedule: giving away only the PM does not free the day (TF-1)
--   4. SwapMatch return dates: one rule for requests and new-shift alerts (TF-3)
--   5. my_schedule / calendar_feed follow the new effective schedule (TF-1)
--   6. my_ledger counts a SwapMatch as one upcoming trade (TF-8)
--   7. member_cards: many member cards in one call (NEXT-09)
--   8. Account removal on request: admin_remove_member (CC-4)
--   9. Cancel requests never get stuck (TF-5) — documented contract
--  10. Privileges for the new functions
-- =============================================================================


-- =============================================================================
-- 1. Accounts can only be created by the app (SEC-6)
--
-- The project's own Supabase sign-up endpoint (/auth/v1/signup, and one-time
-- code / magic-link sign-ins that create users) is switched on, with "Confirm
-- email" on (mailer_autoconfirm = false). The app never uses it: the sign-up
-- page's server action creates accounts with the service key
-- (auth.admin.createUser with email_confirm: true) after its own bot checks
-- (honeypot, form timer, per-IP limit). A script calling the public endpoint
-- with the publishable key would skip those checks, and every account it made
-- would get a profile row (handle_new_user) in the admin Members list.
--
-- What tells the two apart is email_confirmed_at: accounts the app creates are
-- confirmed, public sign-ups are not (their confirmation email is unanswered).
-- BUT Supabase Auth inserts the auth.users row first and sets
-- email_confirmed_at with an UPDATE afterwards, in the same transaction
-- (adminUserCreate: tx.Create(user), then user.Confirm(tx)). A BEFORE INSERT
-- check on NEW.email_confirmed_at would therefore refuse the app's own
-- sign-ups too. So this is a deferred constraint trigger: it runs at COMMIT,
-- re-reads the new row and refuses the whole transaction when the account is
-- still unconfirmed. A public sign-up then fails ("Database error saving new
-- user") and nothing is stored; the app's sign-up is unaffected.
--
-- Refused on purpose as well: magic-link / one-time-code sign-ups, anonymous
-- sign-ins, phone sign-ups and the dashboard's "Invite user". To add someone
-- by hand in the dashboard, use Authentication > Add user > Create new user
-- with "Auto Confirm User" ticked.
--
-- Limits: this relies on "Confirm email" staying on. With it off, public
-- sign-ups are confirmed in the same transaction and look exactly like the
-- app's. Turning off "Allow new users to sign up" in the dashboard is still
-- the first line of defence (admin.createUser keeps working when it is off).
-- =============================================================================
create or replace function private.block_unconfirmed_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- NEW is the row as first inserted; the confirmation arrives later in the
  -- transaction, so look at the row as it is now (at commit).
  if exists (
    select 1 from auth.users u
    where u.id = new.id and u.email_confirmed_at is null
  ) then
    raise exception using
      message = 'ShiftSwap accounts can only be created through the app''s sign-up page.',
      detail = 'The new account''s email address is not confirmed. To add someone in the Supabase dashboard, create the user with "Auto Confirm User" ticked.',
      errcode = '42501';
  end if;
  return null;
end
$$;

drop trigger if exists on_auth_user_created_require_confirmed on auth.users;
create constraint trigger on_auth_user_created_require_confirmed
  after insert on auth.users
  deferrable initially deferred
  for each row execute function private.block_unconfirmed_signup();


-- =============================================================================
-- 2. profiles.removed_at — set when an admin removes an account at the
-- member's request (admin_remove_member, section 8). A removed account is
-- always suspended. Admins list and filter removed members with
-- `removed_at is not null` (they can read every profile row, §6.2).
-- =============================================================================
alter table public.profiles add column if not exists removed_at timestamptz;

alter table public.profiles drop constraint if exists profiles_removed_is_suspended;
alter table public.profiles add constraint profiles_removed_is_suspended
  check (removed_at is null or status = 'suspended');

comment on column public.profiles.removed_at is
  'When an admin removed this account at the member''s request (admin_remove_member). Null for active accounts.';


-- =============================================================================
-- 3. Effective schedule (ARCHITECTURE §4), corrected for PM give-aways (TF-1)
--
-- A PM is 16:00–08:00, the second part of a 24-hour tour day. Giving away
-- only the PM leaves the member on duty 08:00–16:00, so the day stays a work
-- day. Only a 24-Hour give-away frees the whole day.
--   base        = tour is not null and tour_works(tour, d)
--   gave_away   = a covered 24-Hour shift with poster_id = u on d
--   gave_pm     = a covered PM shift with poster_id = u on d (still on duty 0800–1600)
--   picked_up   = a covered shift (any type) with coverer_id = u on d
--   working     = (base and not gave_away) or gave_pm or picked_up
-- gave_pm counts for members with no tour too: a PM can only be given away
-- from a 24-hour shift the member works, the same way an open post is how the
-- app knows a no-tour member works a day.
-- =============================================================================
create or replace function public.gave_away(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.shifts s
    where s.poster_id = p_user_id and s.date = p_date and s.status = 'covered'
      and s.shift_type = '24-Hour'
  )
$$;

comment on function public.gave_away(uuid, date) is
  'True when the member gave their whole shift (24-Hour) away on that day. A PM give-away does not count: see private.gave_away_pm.';

-- The member gave away only the PM (16:00–08:00) of that day, so they still
-- work 08:00–16:00.
create or replace function private.gave_away_pm(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.shifts s
    where s.poster_id = p_user_id and s.date = p_date and s.status = 'covered'
      and s.shift_type = 'PM'
  )
$$;

create or replace function public.effective_works(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (public.base_works(p_user_id, p_date) and not public.gave_away(p_user_id, p_date))
      or private.gave_away_pm(p_user_id, p_date)
      or public.picked_up(p_user_id, p_date)
$$;

-- Is the member still on the hook for (part of) their own shift that day? A
-- tour day not given away in full, a day they gave only the PM away (on duty
-- 08:00–16:00), or a day they have an open post for (how members with no tour
-- show a work day). Such a member must not also pick up someone else's shift
-- that day (request rules YOU_WORK_THAT_DAY, new-shift alerts).
create or replace function private.works_own_shift(p_user_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (public.base_works(p_user_id, p_date) and not public.gave_away(p_user_id, p_date))
      or private.gave_away_pm(p_user_id, p_date)
      or exists (
        select 1 from public.shifts s
        where s.poster_id = p_user_id and s.date = p_date and s.status = 'open'
      )
$$;


-- =============================================================================
-- 4. SwapMatch return dates: one rule (TF-3)
--
-- Could p_member give p_date as the return date of a p_shift_type SwapMatch?
-- The return shift must not have started yet, and it must be the member's own
-- shift to give: their tour day (members with no tour: any day), not already
-- posted or traded away, and not a day they picked up from someone else.
-- request_problems (request_shift, shift_eligibility, confirm_request) and the
-- new-shift fan-out both use it, so an alert only goes to members who could
-- actually request the post.
-- =============================================================================
create or replace function private.can_give_return_date(p_member public.profiles, p_date date, p_shift_type text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    public.shift_starts_at(p_date, p_shift_type) > pg_catalog.now()
      and (p_member.tour is null or public.tour_works(p_member.tour, p_date))
      and not private.has_post(p_member.id, p_date)
      and not public.picked_up(p_member.id, p_date),
    false
  )
$$;

-- request_problems — unchanged except that the requester's side of the
-- return-date rule now comes from private.can_give_return_date.
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
    -- A post is only available while its poster is an active member (see
    -- 0004_internal_helpers.sql).
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

  -- Working that day: a tour day not given away in full, a day they gave only
  -- the PM away (on duty 0800–1600), or a day they have an open post for.
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
      -- The return date must be the requester's own shift to give.
      if not private.can_give_return_date(p_requester, p_return_date, p_shift.shift_type) then
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
-- New-shift fan-out (§6.5): as before, plus for a SwapMatch only members who
-- could give at least one of the offered return dates (TF-3). The poster's
-- side of the return-date rule (off that day, nothing posted) is not repeated
-- here: post_shift checked it for every return date just before fanning out.
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
    and not public.picked_up(m.id, s.date)
    and (
      cardinality(s.return_dates) = 0
      or exists (
        select 1 from unnest(s.return_dates) as r(day)
        where private.can_give_return_date(m, r.day, s.shift_type)
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end
$$;


-- =============================================================================
-- 5. my_schedule and calendar_feed follow the corrected effective schedule
-- (TF-1)
-- =============================================================================

-- my_schedule gains a trailing pm_given_away column, which changes its result
-- type, so it is dropped and recreated (grants are restored in section 10).
--   given_away     I gave this day's shift away (24-Hour or PM; given_shift_id)
--   pm_given_away  …but only the PM, so I'm still on duty 0800–1600
--   working        (base and nothing given away) or pm_given_away or picked_up
drop function if exists public.my_schedule(date, date);

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
  is_swap boolean,
  pm_given_away boolean
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
    (public.tour_works(v_me.tour, d.day) and g.id is null)
      or coalesce(g.shift_type = 'PM', false)
      or k.id is not null,
    o.id,
    g.id,
    k.id,
    coalesce(g.return_leg_of is not null or g.return_leg_id is not null, false)
      or coalesce(k.return_leg_of is not null or k.return_leg_id is not null, false),
    coalesce(g.shift_type = 'PM', false)
  from days d
  -- at most one each: shifts_one_post_per_day / shifts_one_cover_per_day
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
-- calendar_feed — the ICS subscription, today−30 … today+365:
--   work            a day I'm on duty on my own shift: my tour day with nothing
--                   given away ("On duty (Tour N)"), or a day I gave only the
--                   PM away ("On duty 0800–1600", naming who covers the PM)
--   covering        a shift I picked up (not part of a SwapMatch)
--   swap            a SwapMatch leg I work (either direction)
--   covered_for_me  a day I gave my whole 24-Hour shift away (I'm off)
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
  -- my shifts someone else covers (at most one per day)
  given as (
    select s.date as day, s.shift_type, s.station, s.hours, s.coverer_name,
           (s.return_leg_of is not null or s.return_leg_id is not null) as is_swap
    from me
    cross join bounds b
    join public.shifts s on s.poster_id = me.id and s.status = 'covered'
    where s.date between b.first_day and b.last_day
  ),
  work as (
    select b.first_day + i as day, me.tour, me.station
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
  where not exists (select 1 from given g where g.day = w.day)
  union all
  select g.day, 'work'::text,
         case when me.tour is not null and public.tour_works(me.tour, g.day)
           then pg_catalog.format('On duty 0800–1600 (Tour %s)', me.tour)
           else 'On duty 0800–1600'
         end,
         pg_catalog.format('%s · you work 0800–1600. %s covers your PM (1600–0800)%s. Traded in ShiftSwap: make sure it is approved in TeleStaff.',
           private.station_label(g.station), coalesce(nullif(g.coverer_name, ''), 'Another member'),
           case when g.is_swap then ' · SwapMatch' else '' end)
  from me
  join given g on g.shift_type = 'PM'
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
  select g.day, 'covered_for_me'::text,
         pg_catalog.format('Off: %s covering you (%s)', g.coverer_name, g.shift_type),
         pg_catalog.format('%s · %s · %s hours%s. Traded in ShiftSwap: make sure it is approved in TeleStaff.',
           private.station_label(g.station), g.shift_type, g.hours,
           case when g.is_swap then ' · SwapMatch' else '' end)
  from given g
  where g.shift_type = '24-Hour'
  order by 1, 2
$$;


-- =============================================================================
-- 6. my_ledger — `upcoming` counts trades, not legs (TF-8). A SwapMatch is two
-- covered legs with the same partner; both belong to one trade, identified by
-- coalesce(return_leg_of, id) (the original leg's id).
-- =============================================================================
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
      s.starts_at,
      coalesce(s.return_leg_of, s.id) as trade_id
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
    (count(distinct l.trade_id) filter (where l.starts_at > now()))::int,
    max(l.date)
  from legs l
  join public.profiles p on p.id = l.partner
  group by l.partner, p.full_name, p.rank
  order by 11 desc, 2;
end
$$;


-- =============================================================================
-- 7. member_cards (NEXT-09) — the member_card summaries for many members in
-- one call, so a poster's request list needs one round trip instead of one per
-- request. Same objects as member_card plus user_id, for approved members only
-- (others are left out, not reported), in the order asked for, duplicates
-- once. At most 50 members per call.
-- =============================================================================
create or replace function private.member_card_json(p_member public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'full_name', p_member.full_name,
    'rank', p_member.rank,
    'station', p_member.station,
    'battalion', p_member.battalion,
    'trust_score', x.stats -> 'trust_score',
    'covered', x.stats -> 'covered',
    'given', x.stats -> 'given'
  )
  from (select private.member_stats(p_member.id) as stats) x
$$;

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
begin
  select * into v_member from public.profiles p where p.id = p_user_id and p.status = 'approved';
  if not found then
    perform private.fail('That member wasn''t found.', 'NOT_FOUND');
  end if;
  return private.member_card_json(v_member);
end
$$;

create or replace function public.member_cards(p_user_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_cards jsonb;
begin
  if (select count(distinct u.id) from unnest(p_user_ids) as u(id) where u.id is not null) > 50 then
    perform private.fail('Ask for at most 50 members at a time.', 'INVALID_INPUT');
  end if;

  with wanted as (
    select u.id, min(u.ord) as ord
    from unnest(p_user_ids) with ordinality as u(id, ord)
    where u.id is not null
    group by u.id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('user_id', p.id) || private.member_card_json(p) order by w.ord),
    '[]'::jsonb
  )
  into v_cards
  from wanted w
  join public.profiles p on p.id = w.id and p.status = 'approved';

  return v_cards;
end
$$;


-- =============================================================================
-- 8. Account removal on request (CC-4)
--
-- The privacy notice promises that an admin removes an account on request.
-- Deleting the auth user isn't possible for anyone who ever traded (shifts,
-- requests and messages keep their foreign keys to the profile), and the
-- trade history must stay for the other members. admin_remove_member instead
-- closes the account and deletes the member's personal details: see below.
-- -----------------------------------------------------------------------------

-- The caller's profile, as before; a removed account gets its own wording.
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
      case
        when v_me.removed_at is not null then 'This account was removed. Contact an admin if you think this is a mistake.'
        when v_me.status = 'suspended' then 'Your account is suspended. Contact an admin if you think this is a mistake.'
        when v_me.status = 'rejected' then 'Your account wasn''t approved. Contact an admin if you think this is a mistake.'
        when v_me.status = 'onboarding' then 'Finish setting up your profile first.'
        else 'Your account is waiting for an admin to approve it.'
      end,
      'NOT_APPROVED'
    );
  end if;

  return v_me;
end
$$;

-- -----------------------------------------------------------------------------
-- Takes a member out of trading (suspension and removal share this): their
-- upcoming open posts are cancelled with p_note (requesters told) and their
-- own pending requests are closed (posters told). Confirmed trades stay as
-- they are; an admin can void them. Returns {posts_cancelled, requests_closed}.
-- -----------------------------------------------------------------------------
create or replace function private.take_member_off_board(p_member public.profiles, p_actor_id uuid, p_note text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_posts_cancelled int := 0;
  v_requests_closed int := 0;
begin
  -- Upcoming open posts come off the board; their pending requests close.
  with posts as (
    update public.shifts s
       set status = 'cancelled',
           cancelled_at = pg_catalog.now(),
           cancelled_by = p_actor_id,
           cancel_note = p_note
     where s.poster_id = p_member.id and s.status = 'open' and s.starts_at > pg_catalog.now()
    returning s.id, s.date, s.shift_type
  ),
  closed as (
    update public.shift_requests r
       set status = 'cancelled', decided_at = pg_catalog.now()
      from posts
     where r.shift_id = posts.id and r.status = 'pending'
    returning r.requester_id, posts.id as shift_id, posts.date, posts.shift_type
  ),
  told as (
    insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
    select c.requester_id, 'post_cancelled',
           pg_catalog.format('%s shift no longer available', private.fmt_date(c.date)),
           pg_catalog.format('%s''s %s %s post was taken down, so your request was closed.',
                  p_member.full_name, private.fmt_date(c.date), c.shift_type),
           '/trades', c.shift_id, p_actor_id
    from closed c
    returning 1
  )
  select count(*)::int into v_posts_cancelled from posts;

  -- The member's own pending requests on other members' shifts close too.
  with mine as (
    update public.shift_requests r
       set status = 'cancelled', decided_at = pg_catalog.now()
      from public.shifts s
     where r.requester_id = p_member.id and r.status = 'pending' and s.id = r.shift_id
    returning r.shift_id, s.poster_id, s.date, s.shift_type
  ),
  told as (
    insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
    select m.poster_id, 'request_withdrawn',
           pg_catalog.format('%s''s request was closed', p_member.full_name),
           pg_catalog.format('%s''s request for your %s %s shift was closed.',
                  p_member.full_name, private.fmt_date(m.date), m.shift_type),
           '/trades/' || m.shift_id, m.shift_id, p_actor_id
    from mine m
    returning 1
  )
  select count(*)::int into v_requests_closed from mine;

  return jsonb_build_object('posts_cancelled', v_posts_cancelled, 'requests_closed', v_requests_closed);
end
$$;

-- -----------------------------------------------------------------------------
-- admin_set_member_status — as in 0008 (suspend takes the member off the
-- board, see private.take_member_off_board). Reinstating a removed account
-- (approved) clears removed_at: the member adds a phone number again from
-- their profile.
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
  v_board jsonb := jsonb_build_object('posts_cancelled', 0, 'requests_closed', 0);
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
         removed_at = case when p_status = 'approved' then null else p.removed_at end,
         approved_at = case when p_status = 'approved' then coalesce(p.approved_at, now()) else p.approved_at end,
         approved_by = case when p_status = 'approved' then coalesce(p.approved_by, v_admin.id) else p.approved_by end
   where p.id = v_member.id;

  if p_status = 'suspended' then
    v_board := private.take_member_off_board(v_member, v_admin.id, 'Taken down: the member''s account was suspended.');
  end if;

  perform private.notify(
    v_member.id, 'account_status',
    case p_status when 'suspended' then 'Account suspended' else 'Account active again' end,
    case p_status
      when 'suspended' then coalesce('An admin suspended your ShiftSwap account: ' || v_reason,
                                     'An admin suspended your ShiftSwap account.')
        || case when (v_board ->> 'posts_cancelled')::int > 0 then ' Your open posts were taken down.' else '' end
      else 'An admin reinstated your ShiftSwap account.'
    end,
    '/calendar', null, v_admin.id);
  perform private.audit(v_admin.id, 'admin.member_status', 'profile', v_member.id,
    jsonb_build_object('from', v_member.status, 'to', p_status, 'reason', v_reason,
      'posts_cancelled', (v_board ->> 'posts_cancelled')::int,
      'requests_closed', (v_board ->> 'requests_closed')::int,
      'was_removed', v_member.removed_at is not null));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_approve_member — as in 0008; approving a removed account reinstates
-- it (removed_at cleared).
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
         removed_at = null,
         roster_id = coalesce(p_roster_id, p.roster_id),
         approved_at = now(),
         approved_by = v_admin.id
   where p.id = v_member.id;

  perform private.notify(
    v_member.id, 'member_approved', 'You''re approved',
    'An admin approved your ShiftSwap account. You can post and request shifts now.',
    '/calendar', null, v_admin.id);
  perform private.audit(v_admin.id, 'admin.member_approved', 'profile', v_member.id,
    jsonb_build_object('from_status', v_member.status, 'roster_id', p_roster_id,
      'was_removed', v_member.removed_at is not null));
end
$$;

-- -----------------------------------------------------------------------------
-- admin_update_member — as in 0008, but a removed account can't be edited
-- (that would put personal details back on it); reinstate it first.
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
  if v_member.removed_at is not null then
    perform private.fail('This account was removed. Reinstate it first if the member is coming back.', 'INVALID_INPUT');
  end if;
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
-- admin_remove_member — remove an account at the member's request.
--   * the account is closed: status suspended, status_reason "Account removed"
--     (plus the reason, which the member sees), removed_at set, admin rights
--     dropped (reinstating must not bring them back silently)
--   * personal details go: phone, employee ID, the roster link, push
--     subscriptions, their notifications, admins' "waiting for approval"
--     notices about them (they carry the phone and email), and the phone /
--     employee ID copies in earlier admin-edit audit entries
--   * new-shift alerts off and a new calendar token (the old ICS link stops)
--   * off the board exactly like a suspension (private.take_member_off_board)
-- Kept: the name on the profile and the name snapshots on shifts and requests,
-- so other members' trade history and balances still make sense. The login
-- (auth.users email) stays; a suspended account can't use ShiftSwap.
-- Refused for yourself, for an account already removed, and for the last
-- approved admin. Returns {posts_cancelled, requests_closed, upcoming_trades}
-- — upcoming confirmed trades stay; void them if they won't happen.
-- -----------------------------------------------------------------------------
create or replace function public.admin_remove_member(p_user_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.profiles := private.require_admin();
  v_member public.profiles := private.lock_member(p_user_id);
  v_reason text := nullif(btrim(p_reason), '');
  v_board jsonb;
  v_upcoming int;
  v_roster_ids uuid[];
begin
  if v_member.id = v_admin.id then
    perform private.fail('You can''t remove your own account. Ask another admin to do it.', 'INVALID_INPUT');
  end if;
  if v_member.removed_at is not null then
    perform private.fail('This account was already removed.', 'INVALID_INPUT');
  end if;
  if char_length(v_reason) > 500 then
    perform private.fail('Keep the reason under 500 characters.', 'INVALID_INPUT');
  end if;
  if v_member.role = 'admin' and v_member.status = 'approved' and private.other_admin_count(v_member.id) = 0 then
    perform private.fail('You can''t remove the last admin. Make someone else an admin first.', 'LAST_ADMIN');
  end if;

  v_board := private.take_member_off_board(v_member, v_admin.id, 'Taken down: the member''s account was removed.');

  with released as (
    update public.roster r set claimed_by = null where r.claimed_by = v_member.id returning r.id
  )
  select coalesce(array_agg(released.id), '{}'::uuid[]) into v_roster_ids from released;

  update public.profiles p
     set status = 'suspended',
         status_reason = 'Account removed' || coalesce(': ' || v_reason, ''),
         removed_at = now(),
         role = 'member',
         phone = null,
         employee_id = null,
         roster_id = null,
         notify_scope = 'off',
         calendar_token = gen_random_uuid()
   where p.id = v_member.id;

  delete from public.push_subscriptions s where s.user_id = v_member.id;
  delete from public.notifications n where n.user_id = v_member.id;
  delete from public.notifications n where n.actor_id = v_member.id and n.type = 'member_pending';
  update public.audit_log a
     set details = pg_catalog.jsonb_set(
           pg_catalog.jsonb_set(a.details, '{before}', (a.details -> 'before') - 'phone' - 'employee_id'),
           '{after}', (a.details -> 'after') - 'phone' - 'employee_id')
   where a.target_type = 'profile' and a.target_id = v_member.id and a.action = 'admin.member_updated'
     and jsonb_typeof(a.details -> 'before') = 'object' and jsonb_typeof(a.details -> 'after') = 'object';

  select count(distinct coalesce(s.return_leg_of, s.id))::int into v_upcoming
  from public.shifts s
  where s.status = 'covered' and s.starts_at > now()
    and (s.poster_id = v_member.id or s.coverer_id = v_member.id);

  perform private.audit(v_admin.id, 'member.removed', 'profile', v_member.id, jsonb_build_object(
    'from_status', v_member.status, 'from_role', v_member.role, 'reason', v_reason,
    'posts_cancelled', (v_board ->> 'posts_cancelled')::int,
    'requests_closed', (v_board ->> 'requests_closed')::int,
    'upcoming_trades', v_upcoming,
    'roster_ids', to_jsonb(v_roster_ids)));

  return jsonb_build_object(
    'posts_cancelled', (v_board ->> 'posts_cancelled')::int,
    'requests_closed', (v_board ->> 'requests_closed')::int,
    'upcoming_trades', v_upcoming);
end
$$;

-- -----------------------------------------------------------------------------
-- admin_overview — as in 0008; removed accounts are counted on their own
-- (removed_members) instead of as suspended.
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
    'suspended_members', (select count(*) from public.profiles p where p.status = 'suspended' and p.removed_at is null),
    'removed_members', (select count(*) from public.profiles p where p.removed_at is not null),
    'open_shifts', (select count(*) from public.shifts s where s.status = 'open' and s.starts_at > now()),
    'trades_this_month', (
      select count(*) from public.shifts s
      where s.status = 'covered' and s.return_leg_of is null and s.confirmed_at >= v_month_start),
    'roster_size', (select count(*) from public.roster),
    'roster_unclaimed', (select count(*) from public.roster r where r.claimed_by is null)
  );
end
$$;


-- =============================================================================
-- 9. Cancel requests never get stuck (TF-5)
--
-- No SQL change is needed: the functions from 0006 already allow what the
-- review asked for, and tests/db/review-fixes.test.ts pins it. Once either
-- leg has started, agreeing is refused (only an admin can void then), but the
-- member who asked can always withdraw and the other member can always
-- decline, so a pending cancel request can always be closed.
-- =============================================================================
comment on function public.withdraw_trade_cancel(uuid) is
  'The member who asked to cancel takes the request back. Allowed at any time, also after a leg has started.';
comment on function public.respond_trade_cancel(uuid, boolean) is
  'The other member answers a cancel request. Agreeing is refused once either leg has started (an admin can void); declining is always allowed.';


-- =============================================================================
-- 10. Privileges (see 0010_privileges.sql): the new and recreated functions
-- start with no grants; the new RPCs are for signed-in members only.
-- tests/db/privileges.test.ts pins the full list.
-- =============================================================================
revoke all on function
  public.my_schedule(date, date),
  public.member_cards(uuid[]),
  public.admin_remove_member(uuid, text),
  private.block_unconfirmed_signup(),
  private.gave_away_pm(uuid, date),
  private.can_give_return_date(public.profiles, date, text),
  private.member_card_json(public.profiles),
  private.take_member_off_board(public.profiles, uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.my_schedule(date, date),
  public.member_cards(uuid[]),
  public.admin_remove_member(uuid, text)
to authenticated;

-- Ask PostgREST (the Supabase Data API) to pick up the new schema right away.
notify pgrst, 'reload schema';
