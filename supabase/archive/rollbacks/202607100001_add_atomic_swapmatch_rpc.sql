-- Run only after rolling back 202607100002 and the web deployment. The current
-- client has a missing-RPC fallback, but the legacy write policies must exist.

begin;

drop function if exists public.accept_shift_with_match(uuid, date);
drop function if exists public.app_keepalive();

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view all profiles"
on public.profiles
for select
to public
using (true);

commit;
