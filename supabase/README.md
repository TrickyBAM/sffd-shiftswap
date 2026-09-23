# Database (Supabase Postgres)

The schema is defined only by the numbered migrations in `migrations/`
(`0001_*.sql` …), applied in filename order. `docs/ARCHITECTURE.md` §6 is the
contract they implement. `archive/` holds the superseded pre-v1 SQL.

| File | Contents |
|---|---|
| `0001_foundation.sql` | `private` schema, default-privilege hardening, `private.app_config` / `signup_attempts` / `schema_migrations`, `today_pt`, `shift_starts_at`, `tour_works`, `name_key` |
| `0002_tables.sql` | stations (seeded), roster, profiles, shifts, shift_requests, messages, notifications, push_subscriptions, audit_log; constraints, indexes, `updated_at` triggers |
| `0003_access.sql` | `auth.users` → profile trigger, `is_approved()` / `is_admin()`, RLS policies, table grants |
| `0004_internal_helpers.sql` | caller checks, notifications/audit helpers, effective schedule, stats, request rules, trade lock/undo, new-shift fan-out, roster matching |
| `0005`–`0008` | the RPCs (members, shifts & trades, messages, admin) |
| `0009_public_push_realtime.sql` | `app_keepalive`, `calendar_feed`, `claim_push_batch`, `signup_rate_check`, push webhook trigger, realtime publication |
| `0010_privileges.sql` | the complete function API surface per role |

## Applying migrations

The scripts read `POSTGRES_URL_NON_POOLING` (else `DATABASE_URL`, else
`POSTGRES_URL`) from the environment or `.env.local` / `.env`. With the
Vercel ↔ Supabase integration, `vercel env pull .env.local` provides it.

```sh
npm run db:migrate -- --status    # what is applied / pending
npm run db:migrate -- --dry-run   # list pending, change nothing
npm run db:migrate                # apply pending, one transaction per file
```

Never edit a migration that has been applied — add a new `NNNN_*.sql` file.
New functions get no grants by default: add them to a privileges section
(see `0010_privileges.sql`) and to `tests/db/privileges.test.ts`.

## First admin and push webhook

```sh
node scripts/db/make-admin.mjs you@example.com        # after signing up in the app
node scripts/db/set-app-config.mjs push_webhook_url=https://<your-app>/api/push/flush
node scripts/db/set-app-config.mjs push_webhook_secret=@env:PUSH_WEBHOOK_SECRET
```

The webhook only fires when the `pg_net` extension is enabled (Supabase
Dashboard ▸ Database ▸ Extensions) and both keys are set; otherwise the app's
own flush calls deliver pushes.

## Rules that are easy to miss

- **Roster notes are admin-only.** Applicants only learn "approved" or
  "pending"; `profiles.status_reason` stays empty while pending (it carries the
  reason an admin gives when rejecting or suspending). The note on the closest
  roster entry ("Roster: John Smith, Station 19 — tour differs") is in the
  applicant's latest `audit_log` row with `action = 'member.pending'`
  (`details.roster_note`, `details.roster_id` = the candidate entry) and in the
  admins' `member_pending` notice.
- **Auto-approval is tried on an account's first 3 onboarding submissions
  only**, so nobody can guess a colleague's details one try at a time. After
  that, an admin approves.
- **A blank employee ID is a difference** when the roster entry has one, so
  members should enter it to be approved instantly.
- **Suspending a member** cancels their upcoming open posts and closes their
  pending requests (everyone affected is told). Confirmed trades stay; void
  them if needed.
- **A trade can't be undone while it would double-book someone** (they picked
  up another shift on the day they'd get back): undo that other trade first
  (`ALREADY_COVERING`).
- **Push endpoints** must be https URLs on a browser push service (Google FCM,
  Mozilla, Apple, Windows WNS); anything else is refused, so the server never
  posts to an address a member made up.

## Tests

`npm run test:db` runs `tests/db/*.test.ts`: every migration is applied to an
in-memory PGlite (Postgres 18 in WebAssembly) after `tests/db/supabase-stub.sql`
emulates Supabase's roles, `auth` schema and default privileges. No Docker needed.
