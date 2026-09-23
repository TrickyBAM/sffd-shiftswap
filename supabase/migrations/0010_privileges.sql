-- =============================================================================
-- 0010_privileges.sql — the complete function API surface, in one place
-- (ARCHITECTURE §6.2, §6.3).
--
-- Start from nothing (Supabase and Postgres would otherwise let anon and
-- authenticated execute every function), then grant exactly:
--   anon           app_keepalive, calendar_feed
--   authenticated  the member/admin RPCs of §6.3, the RLS helpers and the pure
--                  date/tour/name helpers
--   service_role   claim_push_batch, signup_rate_check, the public endpoints
--                  and the pure helpers
-- Internal helpers (schema private, effective-schedule helpers, trigger
-- functions) are executable by no API role. tests/db/privileges.test.ts pins
-- this list, so a new function must be added here deliberately.
-- =============================================================================

revoke all on all functions in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;

-- Pure helpers (no data access)
grant execute on function
  public.today_pt(),
  public.shift_starts_at(date, text),
  public.tour_works(smallint, date),
  public.name_key(text)
to authenticated, service_role;

-- RLS helpers: policies run them as the querying role, so it needs EXECUTE.
grant execute on function
  public.is_approved(),
  public.is_admin()
to authenticated, service_role;

-- Onboarding & profile
grant execute on function
  public.complete_onboarding(text, text, text, int, int, text),
  public.acknowledge_telestaff(),
  public.update_my_profile(text, int, int, text),
  public.clear_must_change_password(),
  public.regenerate_calendar_token(),
  public.my_stats(),
  public.my_ledger(),
  public.my_schedule(date, date),
  public.get_trade_contact(uuid),
  public.member_card(uuid)
to authenticated;

-- Shifts & trades
grant execute on function
  public.post_shift(date, text, int, date[], text, text),
  public.cancel_post(uuid),
  public.shift_eligibility(uuid, date),
  public.request_shift(uuid, date, text),
  public.withdraw_request(uuid),
  public.decline_request(uuid),
  public.confirm_request(uuid),
  public.request_trade_cancel(uuid, text),
  public.respond_trade_cancel(uuid, boolean),
  public.withdraw_trade_cancel(uuid)
to authenticated;

-- Messages & notifications
grant execute on function
  public.send_message(uuid, uuid, text),
  public.mark_thread_read(uuid, uuid),
  public.mark_notifications_read(uuid[])
to authenticated;

-- Admin (each checks is_admin itself)
grant execute on function
  public.admin_approve_member(uuid, uuid),
  public.admin_reject_member(uuid, text),
  public.admin_set_member_status(uuid, text, text),
  public.admin_set_role(uuid, text),
  public.admin_update_member(uuid, text, text, int, int, text, text),
  public.admin_mark_must_change_password(uuid),
  public.admin_import_roster(jsonb, boolean),
  public.admin_delete_roster_entry(uuid),
  public.admin_cancel_post(uuid, text),
  public.admin_void_trade(uuid, text),
  public.admin_overview()
to authenticated;

-- Public endpoints
grant execute on function
  public.app_keepalive(),
  public.calendar_feed(uuid)
to anon, authenticated, service_role;

-- Server-only
grant execute on function
  public.claim_push_batch(int),
  public.signup_rate_check(text, int, int)
to service_role;

-- Ask PostgREST (the Supabase Data API) to pick up the new schema right away.
notify pgrst, 'reload schema';
