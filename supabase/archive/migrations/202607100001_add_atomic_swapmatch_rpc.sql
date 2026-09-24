-- Phase 1 (safe before the web deploy): add atomic acceptance and a private
-- keepalive RPC, and stop users from reading other members' private profiles.
-- Do not apply phase 2 until the updated web build has been deployed/verified.

begin;

create or replace function public.accept_shift_with_match(
  p_shift_id uuid,
  p_return_date date default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_shift public.shifts%rowtype;
  v_coverer public.profiles%rowtype;
  v_is_swap boolean;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to accept a shift';
  end if;
  if p_shift_id is null then
    raise exception 'Shift id is required';
  end if;

  -- Hold the same row lock for validation, acceptance, and SwapMatch writes.
  -- Any exception below rolls back the nested accept_shift call as well.
  select * into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found then
    raise exception 'Shift not found';
  end if;

  v_is_swap := coalesce(cardinality(v_shift.return_dates), 0) > 0;
  if v_is_swap then
    if p_return_date is null then
      raise exception 'Pick a return date before accepting this SwapMatch';
    end if;
    if not (p_return_date = any(v_shift.return_dates)) then
      raise exception 'That return date is not offered for this SwapMatch';
    end if;
  elsif p_return_date is not null then
    raise exception 'This shift does not offer a return date';
  end if;

  select * into v_coverer
  from public.profiles
  where id = v_user_id;

  if not found then
    raise exception 'Coverer profile not found';
  end if;

  -- Existing protected RPC performs eligibility checks, changes the shift,
  -- updates both trade balances, and creates the standard acceptance alert.
  perform public.accept_shift(p_shift_id);

  if v_is_swap then
    insert into public.matched_trades (
      original_shift_id,
      original_date,
      return_date,
      poster_id,
      taker_id,
      poster_name,
      taker_name,
      status
    ) values (
      v_shift.id,
      v_shift.date,
      p_return_date,
      v_shift.poster_id,
      v_user_id,
      v_shift.poster_name,
      v_coverer.full_name,
      'confirmed'
    );

    insert into public.notifications (
      user_id,
      type,
      title,
      message,
      shift_id,
      related_user_id
    ) values (
      v_shift.poster_id,
      'swap_confirmed',
      'SwapMatch Confirmed!',
      v_coverer.full_name || ' covers your ' ||
        to_char(v_shift.date, 'FMMonth FMDD, YYYY') ||
        ' shift. You cover their ' ||
        to_char(p_return_date, 'FMMonth FMDD, YYYY') ||
        ' shift in return.',
      v_shift.id,
      v_user_id
    );
  end if;

  return json_build_object(
    'success', true,
    'shift_id', p_shift_id,
    'swap_recorded', v_is_swap
  );
end;
$function$;

revoke all on function public.accept_shift_with_match(uuid, date) from public;
revoke all on function public.accept_shift_with_match(uuid, date) from anon;
grant execute on function public.accept_shift_with_match(uuid, date) to authenticated;

-- This performs a real database query without exposing a shift row to the
-- anonymous keepalive job.
create or replace function public.app_keepalive()
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform id from public.shifts limit 1;
  return json_build_object('ok', true);
end;
$function$;

revoke all on function public.app_keepalive() from public;
grant execute on function public.app_keepalive() to anon, authenticated;

drop policy if exists "Users can view all profiles" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

commit;
