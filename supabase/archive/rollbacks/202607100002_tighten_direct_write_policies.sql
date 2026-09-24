-- Emergency rollback for migration 202607100002. This restores the previous,
-- broader policies. Use only to recover service, then re-apply the hardening.

begin;

drop policy if exists "Taker can record accepted SwapMatch" on public.matched_trades;
create policy "Taker can create matched trade"
on public.matched_trades
for insert
to public
with check (auth.uid() = taker_id);

drop policy if exists "Coverer can create SwapMatch notification" on public.notifications;
create policy "Authenticated users can create notifications"
on public.notifications
for insert
to public
with check (auth.uid() is not null);

drop policy if exists "Authenticated users can view shifts" on public.shifts;
create policy "Anyone can view shifts"
on public.shifts
for select
to public
using (true);

commit;
