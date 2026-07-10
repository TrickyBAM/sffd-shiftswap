-- Phase 2: apply only after migration 001 and the compatible web build are
-- live. These policies still permit an already-open legacy tab to finish a
-- legitimate SwapMatch, but prevent arbitrary records and alerts.

begin;

drop policy if exists "Taker can create matched trade" on public.matched_trades;
drop policy if exists "Taker can record accepted SwapMatch" on public.matched_trades;
create policy "Taker can record accepted SwapMatch"
on public.matched_trades
for insert
to authenticated
with check (
  auth.uid() = taker_id
  and status = 'confirmed'
  and exists (
    select 1
    from public.shifts as accepted_shift
    where accepted_shift.id = original_shift_id
      and accepted_shift.status = 'covered'
      and accepted_shift.poster_id = poster_id
      and accepted_shift.coverer_id = auth.uid()
      and accepted_shift.date = original_date
      and return_date = any(accepted_shift.return_dates)
      and poster_name = accepted_shift.poster_name
      and taker_name = accepted_shift.coverer_name
  )
);

drop policy if exists "Authenticated users can create notifications" on public.notifications;
drop policy if exists "Coverer can create SwapMatch notification" on public.notifications;
create policy "Coverer can create SwapMatch notification"
on public.notifications
for insert
to authenticated
with check (
  auth.uid() = related_user_id
  and type = 'swap_confirmed'
  and exists (
    select 1
    from public.matched_trades as accepted_match
    where accepted_match.original_shift_id = shift_id
      and accepted_match.poster_id = user_id
      and accepted_match.taker_id = auth.uid()
  )
);

-- The PWA and app routes are authenticated. The keepalive route now uses the
-- app_keepalive RPC from phase 1 instead of anonymously selecting shift data.
drop policy if exists "Anyone can view shifts" on public.shifts;
drop policy if exists "Authenticated users can view shifts" on public.shifts;
create policy "Authenticated users can view shifts"
on public.shifts
for select
to authenticated
using (true);

commit;
