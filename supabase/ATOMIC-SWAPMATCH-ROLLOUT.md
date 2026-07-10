# Atomic SwapMatch rollout

These files are intentionally split so the installed PWA keeps working during
the database change. Neither migration has been applied to production yet.

## Rollout order

1. Take a fresh Supabase database backup and confirm the current app can post,
   accept, and cancel a test shift.
2. Run `migrations/202607100001_add_atomic_swapmatch_rpc.sql` in the Supabase SQL
   editor. This adds the new RPC, adds the anonymous-safe keepalive RPC, and
   makes profiles readable only by their owner.
3. Deploy the compatible web build. It prefers `accept_shift_with_match`, but
   falls back to the current `accept_shift` only when PostgREST specifically
   reports that the new RPC is missing. The keepalive endpoint also falls back
   until migration 001 is present.
4. On both phones, open the app once while online. Verify login, profile,
   shift-board loading, one normal acceptance, one SwapMatch acceptance, the
   matched trade on the dashboard, both alerts, and `/api/keepalive` returning
   HTTP 200 with `"db": 200`.
5. Run `migrations/202607100002_tighten_direct_write_policies.sql`. It removes
   arbitrary notification/match inserts and anonymous shift reads. Its narrow
   compatibility policies still let an old open tab finish a legitimate match.
6. Repeat the acceptance and keepalive checks. Keep the database backup until
   both phones have worked normally for at least a day.

## Rollback order

If phase 2 causes trouble, run
`rollbacks/202607100002_tighten_direct_write_policies.sql` first. If the problem
continues, roll the Vercel deployment back to the previous build, then run
`rollbacks/202607100001_add_atomic_swapmatch_rpc.sql`.

The phase-2 rollback deliberately restores the old broad policies and is only
an emergency bridge. Re-apply the hardening after the cause is fixed.
