-- =============================================================================
-- 0006_rpc_shifts.sql — posting, requesting, confirming and undoing trades
-- (ARCHITECTURE §3, §6.1, §6.3, §6.5).
--
-- Concurrency: every flow that changes a shift's status locks the shift row
-- first (FOR UPDATE; FOR SHARE when only adding a request), then its requests.
-- The partial unique indexes on shifts are the last line of defence; their
-- violations are turned into friendly errors.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- post_shift
-- -----------------------------------------------------------------------------
create or replace function public.post_shift(
  p_date date,
  p_shift_type text,
  p_station int default null,           -- null = my own station
  p_return_dates date[] default null,   -- SwapMatch offers
  p_accept_limit text default null,     -- null = 'anyone'
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_today date := public.today_pt();
  v_limit text := coalesce(p_accept_limit, 'anyone');
  v_notes text := nullif(btrim(p_notes), '');
  v_station public.stations;
  v_returns date[];
  v_rd date;
  v_starts timestamptz;
  v_id uuid;
begin
  if v_me.telestaff_ack_at is null then
    perform private.fail('Please read and acknowledge the TeleStaff notice first.', 'ACK_REQUIRED');
  end if;

  -- Inputs
  if p_date is null then
    perform private.fail('Pick the date of the shift.', 'INVALID_INPUT');
  end if;
  if p_shift_type is null or p_shift_type not in ('24-Hour', 'PM') then
    perform private.fail('Choose 24-Hour or PM.', 'INVALID_INPUT');
  end if;
  select * into v_station from public.stations s where s.station = coalesce(p_station, v_me.station);
  if not found then
    perform private.fail('Choose a valid station.', 'INVALID_INPUT');
  end if;
  if v_limit not in ('anyone', 'division', 'battalion', 'station') then
    perform private.fail('Choose who can take this shift.', 'INVALID_INPUT');
  end if;
  if char_length(v_notes) > 500 then
    perform private.fail('Notes can be at most 500 characters.', 'INVALID_INPUT');
  end if;
  if p_return_dates is not null and array_position(p_return_dates, null) is not null then
    perform private.fail('One of the return dates is empty.', 'INVALID_INPUT');
  end if;
  -- stored distinct and sorted
  v_returns := coalesce(array(select distinct d from unnest(p_return_dates) as u(d) order by d), '{}'::date[]);
  if cardinality(v_returns) > 10 then
    perform private.fail('Offer at most 10 return dates.', 'INVALID_INPUT');
  end if;

  -- The shift itself
  v_starts := public.shift_starts_at(p_date, p_shift_type);
  if v_starts <= now() then
    perform private.fail('That shift has already started.', 'STARTED');
  end if;
  if p_date > v_today + 180 then
    perform private.fail('You can post shifts up to 180 days ahead.', 'TOO_FAR_AHEAD');
  end if;
  if v_me.tour is not null and not public.tour_works(v_me.tour, p_date) then
    perform private.fail(
      format('%s isn''t one of your tour days. You can only post your own shifts.', private.fmt_date(p_date)),
      'NOT_YOUR_SHIFT_DAY');
  end if;
  if public.picked_up(v_me.id, p_date) then
    perform private.fail(
      format('You''re covering someone on %s. Picked-up shifts can''t be traded again.', private.fmt_date(p_date)),
      'NOT_YOUR_SHIFT_DAY');
  end if;
  if private.has_post(v_me.id, p_date) then
    perform private.fail(
      format('You already posted or traded your %s shift.', private.fmt_date(p_date)),
      'ALREADY_POSTED');
  end if;

  -- SwapMatch return dates: future, not the shift day, within 180 days, and
  -- days the poster is off with nothing posted.
  foreach v_rd in array v_returns loop
    if v_rd = p_date then
      perform private.fail('A return date can''t be the same day as the shift.', 'RETURN_DATE_INVALID');
    end if;
    if public.shift_starts_at(v_rd, p_shift_type) <= now() then
      perform private.fail(format('The return date %s has already passed.', private.fmt_date(v_rd)), 'RETURN_DATE_INVALID');
    end if;
    if v_rd > v_today + 180 then
      perform private.fail('Return dates must be within 180 days.', 'TOO_FAR_AHEAD');
    end if;
    if public.effective_works(v_me.id, v_rd) or private.has_post(v_me.id, v_rd) then
      perform private.fail(
        format('You''re working on %s. Pick return dates when you''re off.', private.fmt_date(v_rd)),
        'POSTER_WORKS_RETURN_DAY');
    end if;
  end loop;

  begin
    insert into public.shifts (
      poster_id, poster_name, rank, station, battalion, division,
      date, shift_type, hours, starts_at, status, return_dates, accept_limit, notes
    )
    values (
      v_me.id, v_me.full_name, v_me.rank, v_station.station, v_station.battalion, v_station.division,
      p_date, p_shift_type, case p_shift_type when '24-Hour' then 24 else 16 end, v_starts, 'open',
      v_returns, v_limit, v_notes
    )
    returning id into v_id;
  exception when unique_violation then
    perform private.fail(
      format('You already posted or traded your %s shift.', private.fmt_date(p_date)),
      'ALREADY_POSTED');
  end;

  perform private.fan_out_new_shift(v_id);
  perform private.audit(v_me.id, 'shift.posted', 'shift', v_id, jsonb_build_object(
    'date', p_date, 'shift_type', p_shift_type, 'station', v_station.station,
    'return_dates', to_jsonb(v_returns), 'accept_limit', v_limit));
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- cancel_post — the poster withdraws an open, not-started post. Pending
-- requests are cancelled and their requesters told.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_post(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_shift public.shifts;
begin
  select * into v_shift from public.shifts s where s.id = p_shift_id for update;
  if not found then
    perform private.fail('That shift no longer exists.', 'NOT_FOUND');
  end if;
  if v_shift.poster_id <> v_me.id then
    perform private.fail('Only the member who posted this shift can cancel it.', 'NOT_PARTICIPANT');
  end if;
  if v_shift.status <> 'open' then
    perform private.fail('This post is no longer open. To undo a confirmed trade, ask to cancel it instead.', 'NOT_OPEN');
  end if;
  if v_shift.starts_at <= now() then
    perform private.fail('This shift has already started.', 'STARTED');
  end if;

  update public.shifts s
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_me.id
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
         format('%s cancelled their %s %s post, so your request was closed.',
                v_shift.poster_name, private.fmt_date(v_shift.date), v_shift.shift_type),
         '/trades', v_shift.id, v_me.id
  from cancelled c;

  perform private.audit(v_me.id, 'shift.cancelled', 'shift', v_shift.id,
    jsonb_build_object('date', v_shift.date));
end
$$;

-- -----------------------------------------------------------------------------
-- shift_eligibility — could the caller request this shift? Same rules as
-- request_shift, reported instead of raised:
--   {eligible, reasons: [{code, message}], valid_return_dates: [date]}
-- With no p_return_date on a SwapMatch, the offered dates are each checked and
-- valid_return_dates lists the ones that would work for the caller.
-- -----------------------------------------------------------------------------
create or replace function public.shift_eligibility(p_shift_id uuid, p_return_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_shift public.shifts;
  v_reasons jsonb := '[]'::jsonb;
  v_valid date[] := '{}';
  v_rd date;
  v_problems jsonb;
  v_return_codes constant text[] := array[
    'RETURN_DATE_REQUIRED', 'RETURN_DATE_INVALID', 'RETURN_NOT_YOUR_DAY', 'POSTER_WORKS_RETURN_DAY'];
begin
  select * into v_shift from public.shifts s where s.id = p_shift_id;
  if not found then
    return jsonb_build_object('eligible', false, 'valid_return_dates', '[]'::jsonb,
      'reasons', private.problem('NOT_FOUND', 'That shift no longer exists.'));
  end if;

  if v_me.telestaff_ack_at is null then
    v_reasons := v_reasons || private.problem('ACK_REQUIRED', 'Please read and acknowledge the TeleStaff notice first.');
  end if;

  if p_return_date is null and cardinality(v_shift.return_dates) > 0 then
    -- Rules that don't depend on the return date …
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_problems
    from jsonb_array_elements(private.request_problems(v_shift, v_me, v_shift.return_dates[1], false)) as e
    where not (e ->> 'code' = any (v_return_codes));
    v_reasons := v_reasons || v_problems;
    -- … and which offered return dates would work.
    foreach v_rd in array v_shift.return_dates loop
      if not exists (
        select 1 from jsonb_array_elements(private.request_problems(v_shift, v_me, v_rd, false)) as e
        where e ->> 'code' = any (v_return_codes)
      ) then
        v_valid := v_valid || v_rd;
      end if;
    end loop;
    if cardinality(v_valid) = 0 then
      v_reasons := v_reasons || private.problem('RETURN_NOT_YOUR_DAY',
        'None of the offered return dates work with your schedule.');
    end if;
  else
    v_problems := private.request_problems(v_shift, v_me, p_return_date, false);
    v_reasons := v_reasons || v_problems;
    if p_return_date is not null and not exists (
      select 1 from jsonb_array_elements(v_problems) as e where e ->> 'code' = any (v_return_codes)
    ) then
      v_valid := array[p_return_date];
    end if;
  end if;

  return jsonb_build_object(
    'eligible', jsonb_array_length(v_reasons) = 0,
    'reasons', v_reasons,
    'valid_return_dates', to_jsonb(v_valid)
  );
end
$$;

-- -----------------------------------------------------------------------------
-- request_shift
-- -----------------------------------------------------------------------------
create or replace function public.request_shift(
  p_shift_id uuid,
  p_return_date date default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_message text := nullif(btrim(p_message), '');
  v_shift public.shifts;
  v_problems jsonb;
  v_id uuid;
begin
  if v_me.telestaff_ack_at is null then
    perform private.fail('Please read and acknowledge the TeleStaff notice first.', 'ACK_REQUIRED');
  end if;
  if char_length(v_message) > 300 then
    perform private.fail('Your message can be at most 300 characters.', 'INVALID_INPUT');
  end if;

  -- FOR SHARE: concurrent requests are fine, but not while the poster confirms.
  select * into v_shift from public.shifts s where s.id = p_shift_id for share;
  if not found then
    perform private.fail('That shift no longer exists.', 'NOT_FOUND');
  end if;

  v_problems := private.request_problems(v_shift, v_me, p_return_date, false);
  if jsonb_array_length(v_problems) > 0 then
    perform private.fail(v_problems -> 0 ->> 'message', v_problems -> 0 ->> 'code');
  end if;

  begin
    insert into public.shift_requests (
      shift_id, requester_id, requester_name, requester_rank, requester_station, return_date, message
    )
    values (v_shift.id, v_me.id, v_me.full_name, v_me.rank, v_me.station, p_return_date, v_message)
    returning id into v_id;
  exception when unique_violation then
    perform private.fail('You already have a request waiting on this shift.', 'ALREADY_REQUESTED');
  end;

  perform private.notify(
    v_shift.poster_id,
    'request_received',
    format('%s wants your %s shift', v_me.full_name, private.fmt_date(v_shift.date)),
    format('%s · %s%s%s', v_me.rank, private.station_label(v_me.station),
      case when p_return_date is not null
        then format(' · offers %s in return', private.fmt_date(p_return_date)) else '' end,
      case when v_message is not null
        then format(' · "%s"', left(v_message, 120)) else '' end),
    '/trades/' || v_shift.id,
    v_shift.id,
    v_me.id
  );
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- withdraw_request — the requester takes back a pending request.
-- -----------------------------------------------------------------------------
create or replace function public.withdraw_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_req public.shift_requests;
  v_shift public.shifts;
begin
  select * into v_req from public.shift_requests r where r.id = p_request_id;
  if not found then
    perform private.fail('That request no longer exists.', 'NOT_FOUND');
  end if;
  if v_req.requester_id <> v_me.id then
    perform private.fail('Only the member who made this request can withdraw it.', 'NOT_PARTICIPANT');
  end if;

  select * into v_shift from public.shifts s where s.id = v_req.shift_id for update;
  select * into v_req from public.shift_requests r where r.id = p_request_id for update;
  if v_req.status <> 'pending' then
    perform private.fail('This request is no longer pending.', 'NOT_OPEN');
  end if;

  update public.shift_requests r
     set status = 'withdrawn', decided_at = now()
   where r.id = v_req.id;

  perform private.notify(
    v_shift.poster_id,
    'request_withdrawn',
    format('%s withdrew their request', v_me.full_name),
    format('%s no longer wants your %s %s shift.', v_me.full_name, private.fmt_date(v_shift.date), v_shift.shift_type),
    '/trades/' || v_shift.id,
    v_shift.id,
    v_me.id
  );
end
$$;

-- -----------------------------------------------------------------------------
-- decline_request — the poster turns down a pending request.
-- -----------------------------------------------------------------------------
create or replace function public.decline_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_req public.shift_requests;
  v_shift public.shifts;
begin
  select * into v_req from public.shift_requests r where r.id = p_request_id;
  if not found then
    perform private.fail('That request no longer exists.', 'NOT_FOUND');
  end if;

  select * into v_shift from public.shifts s where s.id = v_req.shift_id for update;
  if v_shift.poster_id <> v_me.id then
    perform private.fail('Only the member who posted this shift can decline requests.', 'NOT_PARTICIPANT');
  end if;
  select * into v_req from public.shift_requests r where r.id = p_request_id for update;
  if v_req.status <> 'pending' then
    perform private.fail('This request is no longer pending.', 'NOT_OPEN');
  end if;

  update public.shift_requests r
     set status = 'declined', decided_at = now()
   where r.id = v_req.id;

  perform private.notify(
    v_req.requester_id,
    'request_declined',
    format('Request for %s declined', private.fmt_date(v_shift.date)),
    format('%s declined your request for their %s %s shift.', v_shift.poster_name,
      private.fmt_date(v_shift.date), v_shift.shift_type),
    '/trades',
    v_shift.id,
    v_me.id
  );
end
$$;

-- -----------------------------------------------------------------------------
-- confirm_request — the poster picks one request; that makes the trade.
-- Re-validates every request rule against current data, then: shift covered,
-- request accepted, every other pending request declined (with a polite
-- notice), and for a SwapMatch the return leg is created (§6.1).
-- Returns {shift_id, return_leg_id}.
-- -----------------------------------------------------------------------------
create or replace function public.confirm_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_req public.shift_requests;
  v_shift public.shifts;
  v_requester public.profiles;
  v_problems jsonb;
  v_leg_id uuid;
  v_rd date;
begin
  select * into v_req from public.shift_requests r where r.id = p_request_id;
  if not found then
    perform private.fail('That request no longer exists.', 'NOT_FOUND');
  end if;

  -- Lock the shift first: this serialises confirm/cancel/withdraw on it, so a
  -- shift can never be confirmed twice.
  select * into v_shift from public.shifts s where s.id = v_req.shift_id for update;
  if v_shift.poster_id <> v_me.id then
    perform private.fail('Only the member who posted this shift can confirm requests.', 'NOT_PARTICIPANT');
  end if;
  select * into v_req from public.shift_requests r where r.id = p_request_id for update;
  if v_req.status <> 'pending' then
    perform private.fail('This request is no longer pending.', 'NOT_OPEN');
  end if;

  select * into v_requester from public.profiles p where p.id = v_req.requester_id;
  if v_requester.status <> 'approved' then
    perform private.fail(format('%s''s account isn''t active right now.', v_requester.full_name), 'NOT_APPROVED');
  end if;

  v_problems := private.request_problems(v_shift, v_requester, v_req.return_date, true);
  if jsonb_array_length(v_problems) > 0 then
    perform private.fail(v_problems -> 0 ->> 'message', v_problems -> 0 ->> 'code');
  end if;

  v_rd := v_req.return_date;

  begin
    update public.shifts s
       set status = 'covered',
           coverer_id = v_requester.id,
           coverer_name = v_requester.full_name,
           confirmed_at = now(),
           cancel_requested_by = null,
           cancel_requested_at = null,
           cancel_reason = null
     where s.id = v_shift.id;

    if v_rd is not null then
      -- SwapMatch return leg: the requester's shift on the return date, covered
      -- by the original poster.
      insert into public.shifts (
        poster_id, poster_name, rank, station, battalion, division,
        date, shift_type, hours, starts_at, status, return_dates, accept_limit,
        coverer_id, coverer_name, confirmed_at, return_leg_of
      )
      values (
        v_requester.id, v_requester.full_name, v_requester.rank,
        v_requester.station, v_requester.battalion, v_requester.division,
        v_rd, v_shift.shift_type, v_shift.hours, public.shift_starts_at(v_rd, v_shift.shift_type),
        'covered', '{}', 'anyone',
        v_me.id, v_me.full_name, now(), v_shift.id
      )
      returning id into v_leg_id;

      update public.shifts s set return_leg_id = v_leg_id where s.id = v_shift.id;
    end if;
  exception when unique_violation then
    perform private.fail('One of you is already booked that day. Refresh and try again.', 'ALREADY_COVERING');
  end;

  update public.shift_requests r
     set status = 'accepted', decided_at = now()
   where r.id = v_req.id;

  with declined as (
    update public.shift_requests r
       set status = 'declined', decided_at = now()
     where r.shift_id = v_shift.id and r.status = 'pending' and r.id <> v_req.id
    returning r.requester_id
  )
  insert into public.notifications (user_id, type, title, body, url, shift_id, actor_id)
  select d.requester_id, 'request_declined',
         format('%s shift was filled', private.fmt_date(v_shift.date)),
         format('Thanks for offering! %s''s %s %s shift was filled by another member.',
                v_shift.poster_name, private.fmt_date(v_shift.date), v_shift.shift_type),
         '/trades', v_shift.id, v_me.id
  from declined d;

  perform private.notify(
    v_requester.id,
    'request_accepted',
    format('Trade confirmed: %s', private.fmt_date(v_shift.date)),
    format('%s confirmed: you''re covering their %s %s shift at %s.%s Remember to get the trade approved in TeleStaff.',
      v_me.full_name, private.fmt_date(v_shift.date), v_shift.shift_type, private.station_label(v_shift.station),
      case when v_rd is not null
        then format(' In return, %s works your %s shift.', v_me.full_name, private.fmt_date(v_rd)) else '' end),
    '/trades/' || v_shift.id,
    v_shift.id,
    v_me.id
  );

  perform private.audit(v_me.id, 'trade.confirmed', 'shift', v_shift.id, jsonb_build_object(
    'request_id', v_req.id, 'coverer_id', v_requester.id, 'date', v_shift.date,
    'return_date', v_rd, 'return_leg_id', v_leg_id));

  return jsonb_build_object('shift_id', v_shift.id, 'return_leg_id', v_leg_id);
end
$$;

-- -----------------------------------------------------------------------------
-- request_trade_cancel — either party asks to undo a confirmed trade before it
-- starts (both legs of a SwapMatch must not have started). Works on either leg.
-- Refused up front (ALREADY_COVERING) when undoing it would double-book the
-- member asking: they have picked up another shift on the day they would get
-- back, and can sort that out first. If it is the other member who would be
-- double-booked, the request goes through and agreeing to it is refused until
-- they have (respond_trade_cancel → private.undo_trade checks both sides).
-- -----------------------------------------------------------------------------
create or replace function public.request_trade_cancel(p_shift_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_reason text := nullif(btrim(p_reason), '');
  v_orig public.shifts;
  v_leg public.shifts;
  v_other uuid;
  v_conflict text;
begin
  if char_length(v_reason) > 500 then
    perform private.fail('Keep the reason under 500 characters.', 'INVALID_INPUT');
  end if;

  v_orig := private.lock_trade(p_shift_id);
  if v_orig.status <> 'covered' then
    perform private.fail('This trade isn''t active.', 'NOT_OPEN');
  end if;
  if v_me.id <> v_orig.poster_id and v_me.id <> v_orig.coverer_id then
    perform private.fail('Only the two members in this trade can ask to cancel it.', 'NOT_PARTICIPANT');
  end if;
  select * into v_leg from public.shifts s where s.id = v_orig.return_leg_id;
  if v_orig.starts_at <= now() or (v_leg.id is not null and v_leg.starts_at <= now()) then
    perform private.fail('This trade has already started, so it can''t be cancelled here. Ask an admin if it needs to be voided.', 'STARTED');
  end if;
  if v_orig.cancel_requested_by is not null then
    perform private.fail('A cancel request is already waiting for an answer.', 'ALREADY_REQUESTED');
  end if;
  v_conflict := private.undo_trade_conflict(v_orig, v_me.id, true);
  if v_conflict is not null then
    perform private.fail(v_conflict, 'ALREADY_COVERING');
  end if;

  update public.shifts s
     set cancel_requested_by = v_me.id,
         cancel_requested_at = now(),
         cancel_reason = v_reason
   where s.id = v_orig.id;

  v_other := case when v_me.id = v_orig.poster_id then v_orig.coverer_id else v_orig.poster_id end;
  perform private.notify(
    v_other,
    'cancel_requested',
    format('%s asked to cancel a trade', v_me.full_name),
    format('%s wants to cancel the %s %s trade%s.%s Open it to agree or decline.',
      v_me.full_name, private.fmt_date(v_orig.date), v_orig.shift_type,
      case when v_leg.id is not null then format(' (and the %s return shift)', private.fmt_date(v_leg.date)) else '' end,
      case when v_reason is not null then format(' Reason: "%s".', left(v_reason, 200)) else '' end),
    '/trades/' || v_orig.id,
    v_orig.id,
    v_me.id
  );
  perform private.audit(v_me.id, 'trade.cancel_requested', 'shift', v_orig.id,
    jsonb_build_object('reason', v_reason));
end
$$;

-- -----------------------------------------------------------------------------
-- respond_trade_cancel — the other party agrees (the trade is undone: original
-- leg reopens, return leg cancelled) or declines (the request is cleared).
-- Agreeing is refused (ALREADY_COVERING, raised by private.undo_trade) while
-- undoing would double-book either member; the cancel request stays open.
-- -----------------------------------------------------------------------------
create or replace function public.respond_trade_cancel(p_shift_id uuid, p_agree boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_orig public.shifts;
  v_leg public.shifts;
  v_asker uuid;
  v_reopened boolean;
  v_title text;
  v_body text;
begin
  if p_agree is null then
    perform private.fail('Choose agree or decline.', 'INVALID_INPUT');
  end if;

  v_orig := private.lock_trade(p_shift_id);
  if v_orig.status <> 'covered' or v_orig.cancel_requested_by is null then
    perform private.fail('There''s no cancel request waiting on this trade.', 'NO_CANCEL_PENDING');
  end if;
  if v_me.id <> v_orig.poster_id and v_me.id <> v_orig.coverer_id then
    perform private.fail('Only the two members in this trade can answer.', 'NOT_PARTICIPANT');
  end if;
  if v_me.id = v_orig.cancel_requested_by then
    perform private.fail('You asked to cancel. The other member needs to answer.', 'NOT_PARTICIPANT');
  end if;
  v_asker := v_orig.cancel_requested_by;
  select * into v_leg from public.shifts s where s.id = v_orig.return_leg_id;

  if p_agree then
    if v_orig.starts_at <= now() or (v_leg.id is not null and v_leg.starts_at <= now()) then
      perform private.fail('This trade has already started, so it can''t be cancelled here. Ask an admin if it needs to be voided.', 'STARTED');
    end if;

    v_reopened := private.undo_trade(v_orig, v_me.id, 'Cancelled by agreement');

    v_title := format('Trade cancelled: %s', private.fmt_date(v_orig.date));
    v_body := format('%s and %s agreed to cancel the %s %s trade%s.%s If it was already entered in TeleStaff, update it there too.',
      v_orig.poster_name, v_orig.coverer_name, private.fmt_date(v_orig.date), v_orig.shift_type,
      case when v_leg.id is not null then format(' and the %s return shift', private.fmt_date(v_leg.date)) else '' end,
      case when v_reopened then ' The shift is open on the board again.' else '' end);
    perform private.notify(v_orig.poster_id, 'trade_cancelled', v_title, v_body, '/trades/' || v_orig.id, v_orig.id, v_me.id);
    perform private.notify(v_orig.coverer_id, 'trade_cancelled', v_title, v_body, '/trades/' || v_orig.id, v_orig.id, v_me.id);
    perform private.audit(v_me.id, 'trade.cancelled', 'shift', v_orig.id, jsonb_build_object(
      'requested_by', v_asker, 'coverer_id', v_orig.coverer_id, 'return_leg_id', v_leg.id,
      'reopened', v_reopened, 'reason', v_orig.cancel_reason));
  else
    update public.shifts s
       set cancel_requested_by = null, cancel_requested_at = null, cancel_reason = null
     where s.id = v_orig.id;

    perform private.notify(
      v_asker,
      'cancel_declined',
      format('Cancel request declined: %s', private.fmt_date(v_orig.date)),
      format('%s wants to keep the %s %s trade, so it stays confirmed.',
        v_me.full_name, private.fmt_date(v_orig.date), v_orig.shift_type),
      '/trades/' || v_orig.id,
      v_orig.id,
      v_me.id
    );
    perform private.audit(v_me.id, 'trade.cancel_declined', 'shift', v_orig.id,
      jsonb_build_object('requested_by', v_asker));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- withdraw_trade_cancel — the member who asked to cancel changes their mind.
-- -----------------------------------------------------------------------------
create or replace function public.withdraw_trade_cancel(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.require_member(true);
  v_orig public.shifts;
begin
  v_orig := private.lock_trade(p_shift_id);
  if v_orig.status <> 'covered' or v_orig.cancel_requested_by is null then
    perform private.fail('There''s no cancel request waiting on this trade.', 'NO_CANCEL_PENDING');
  end if;
  if v_orig.cancel_requested_by <> v_me.id then
    perform private.fail('Only the member who asked to cancel can take it back.', 'NOT_PARTICIPANT');
  end if;

  update public.shifts s
     set cancel_requested_by = null, cancel_requested_at = null, cancel_reason = null
   where s.id = v_orig.id;

  -- The other member no longer needs to act on the request.
  update public.notifications n
     set read_at = now()
   where n.shift_id = v_orig.id and n.type = 'cancel_requested' and n.actor_id = v_me.id and n.read_at is null;

  perform private.audit(v_me.id, 'trade.cancel_withdrawn', 'shift', v_orig.id, '{}'::jsonb);
end
$$;
