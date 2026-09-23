# SFFD ShiftSwap: Handoff

For the next developer or AI agent picking this project up cold. Read this, then
`docs/ARCHITECTURE.md` (the binding design and build contract; its section 9
"Implementation notes" overrides earlier sections where they differ), then
`AGENTS.md`.

No secrets live in this file or anywhere in the repository. They are in Vercel
(environment variables) and in your local `.env.local` (from `vercel env pull`,
gitignored).

---

## 1. What this is

A shift-trading web app (installable PWA) for San Francisco Fire Department
fire-side members. A member posts one of their shifts; same-rank members request
it (optionally proposing a SwapMatch return date); the poster confirms one
request, which makes a trade. Undoing a trade needs both parties to agree (or an
admin voids it). Sign-ups that match the uploaded department roster are approved
automatically; others wait for an admin. Work schedules come from the member's
tour number (the SFFD 31-day rotation). TeleStaff remains the official system of
record, and members acknowledge that once.

- **Owner and admin:** Brian Machado, an SFFD firefighter and not a developer
  (GitHub `TrickyBAM`). Explain things in plain English and show outcomes. He
  prefers that you do setup chores yourself (CLI or API) rather than hand him steps.
- **Users:** firefighters on phones, mostly iPhones with the app installed to the
  home screen.

## 2. Current state (2026-09-23)

- **Branch `release/v1`** holds the v1 rebuild. `main` is the default branch and
  what production should deploy from once v1 is merged.
- **Database:** the final schema (`supabase/migrations/0001` to `0010`) is applied
  to the live Supabase database. Don't edit applied migrations; add new numbered files.
- **App code:** the typed data layer (`src/lib/api`), UI primitives, app shell, all
  routes in ARCHITECTURE section 7.1, and the API routes (keepalive, push flush,
  calendar feed) were built on `release/v1`. Before merging, confirm the branch is
  green: `npm run check` and `npm run build`, then a manual pass through
  `docs/USER-GUIDE.md` on a phone.
- **Production** (<https://sffd-shiftswap.vercel.app>) was still serving a
  pre-v1 build from July 2026 when this was written. That build pointed at the old
  Supabase project (`mddpdrkxexxpyneqmxfi`), which is gone. v1 goes live when
  `release/v1` is merged and deployed (`docs/DEPLOY.md`).
- **After the first production deploy:** set the VAPID and webhook variables,
  enable the push webhook, make Brian an admin and upload the roster
  (`docs/DEPLOY.md` and `docs/ADMIN-GUIDE.md`).

## 3. Services

| Service | Details |
|---|---|
| **Vercel** | Project `sffd-shiftswap`, id `prj_bu8GRjkHNirIdE1hqvMe5LlUpFEy`, team `team_9KHmhLMjNKAUp6suv3umdjdl`, Hobby plan, Node 24.x. Production URL <https://sffd-shiftswap.vercel.app>. Preview URLs are behind Vercel Authentication (sign in to Vercel to open them). The Vercel CLI on Brian's PC is logged in, and the local clone is linked (`vercel link`). |
| **Supabase** (via the Vercel Marketplace) | Resource `sffd-shiftswap-db`, project ref `xyywfujcjqadoldmydef`, region `sfo1`, **free plan**, Postgres 17. Billed through Brian's Vercel account; open it from Vercel ▸ Storage. The integration manages the Supabase environment variables in Vercel. |
| **GitHub** | `TrickyBAM/sffd-shiftswap`, default branch `main`. v1 work is on `release/v1`. Workflows: `.github/workflows/ci.yml` (lint, typecheck, tests, build) and `keepalive.yml` (daily ping). Old branches `master` and `codex/bootstrap` hold a 2025 Firebase version and are stale. |

The local Windows clone is
`C:\Users\TrickyBAM\Documents\New project\codex-repos\sffd-shiftswap`.
Brian's earlier Mac copy (`/Users/teslamac/sffd-shiftswap`) and the Vite
prototype are stale.

## 4. Architecture in brief

All details are in `docs/ARCHITECTURE.md`. The shape:

- **Database first.** Every rule (eligibility, same rank, schedule conflicts,
  SwapMatch legs, mutual cancel, roster matching, notification fan-out) lives in
  Postgres RPCs (`security definer`, `search_path = ''`, friendly `raise` messages
  with a hint code). Row Level Security (RLS) guards every table; anon gets nothing except
  `app_keepalive` and `calendar_feed`. The browser talks to Supabase directly with
  the member's session.
- **`src/lib/api/*`**: one typed function per RPC or read. Each takes a Supabase
  client first, returns data and throws `AppError` (`src/lib/errors.ts`) whose
  `message` is safe to show. Mutations that notify someone fire-and-forget
  `POST /api/push/flush`.
- **Dates** are `YYYY-MM-DD` strings in America/Los_Angeles. Use
  `src/lib/sffd/dates.ts`, and never `new Date('YYYY-MM-DD')`.
- **Tours** are computed in `src/lib/sffd/tours.ts` and SQL `tour_works()`,
  tested against each other.
- **Gates** are in server layouts: `src/app/(app)/layout.tsx` sends members to
  `/onboarding`, `/pending`, `/change-password` or `/welcome` as needed, and
  shows an error screen (never a redirect) when the database can't be reached.
  `src/proxy.ts` only refreshes the session, bounces signed-out users and
  handles legacy URLs.
- **Push:** a database trigger calls `/api/push/flush` through `pg_net` when
  configured; the app also calls it after actions. The route claims pending
  notifications (`claim_push_batch`), sends them with `web-push` and removes
  dead subscriptions (`src/lib/push/server.ts`).
- **Calendar feed:** `/api/calendar/<token>` serves ICS (`src/lib/ics.ts`) from
  `calendar_feed()`; the token is the member's secret.
- **Keepalive:** `/api/keepalive` calls `app_keepalive()`. It is pinged daily by
  the Vercel cron (`vercel.json`) and the GitHub Action, so the free database
  isn't paused.

Code map:

```
src/app/(auth)       login, signup            src/app/(onboard)  onboarding, pending, welcome, change-password
src/app/(app)        calendar, board, post, trades, alerts, profile, admin/*
src/app/api          keepalive, push/flush, calendar/[token]  (+ _lib helpers)
src/lib/api          typed data layer         src/lib/sffd       dates, tours, stations, ranks, shift types
src/lib/supabase     client/server/admin/session clients      src/lib/push  client (subscribe) + server (send)
src/components/ui    primitives               src/components     shell, header, navigation, pickers, providers
supabase/migrations  schema                   tests/unit, tests/db  Vitest suites
scripts/db           migrate, make-admin, set-app-config       scripts/smoke  live end-to-end smoke test
```

## 5. Common tasks

All database scripts read `POSTGRES_URL_NON_POOLING` from `.env.local`. Run
`vercel env pull .env.local` first. They never print passwords, keys or secret
config values.

**Apply migrations**

```sh
npm run db:migrate -- --status    # applied and pending files
npm run db:migrate -- --dry-run   # what would run
npm run db:migrate                # apply pending files, one transaction each
```

A new migration is a new `supabase/migrations/NNNN_name.sql`. New functions get
no grants by default. Add them to a privileges section and to
`tests/db/privileges.test.ts`. Keep `src/lib/types/database.ts` and
`src/lib/api` in step.

**Make an admin**: the first time only. After that, admins use Admin ▸ Members.

```sh
node scripts/db/make-admin.mjs someone@example.com   # they must have signed up first
```

**Set database settings** (`private.app_config`), e.g. the push webhook:

```sh
node scripts/db/set-app-config.mjs --list
node scripts/db/set-app-config.mjs push_webhook_url=https://sffd-shiftswap.vercel.app/api/push/flush
node scripts/db/set-app-config.mjs push_webhook_secret=@env:PUSH_WEBHOOK_SECRET   # read from env, not typed
node scripts/db/set-app-config.mjs --unset push_webhook_url push_webhook_secret
```

The webhook also needs `create extension if not exists pg_net;` (Supabase
dashboard ▸ Database ▸ Extensions, or SQL editor). Full steps are in
`docs/DEPLOY.md`.

**Generate VAPID keys** (only if they don't exist yet; changing them breaks
every existing push subscription): `npx web-push generate-vapid-keys`.

**Smoke-test the live database** before a release:
`node scripts/smoke/live-smoke.mjs`. It creates `e2e-*@example.com` members,
runs the trade flows and deletes everything it made.

## 6. Testing strategy

- **Unit tests** (`tests/unit`, `npm run test:unit`): dates, tours against a
  fixture for all 31 tours from 2019 to 2035, roster CSV and name matching, ICS output,
  effective schedule, errors, env, API wrappers, the proxy, and the platform
  routes (`platform-*.test.ts` for the layout gates, push flush and keepalive;
  `ics-route-*.test.ts` for the calendar feed). Route tests use the real
  supabase-js client with a stubbed `fetch`, so they check the exact PostgREST
  requests. `web-push` is faked.
- **Database tests** (`tests/db`, `npm run test:db`): every migration runs inside
  **PGlite** (Postgres 18 in WebAssembly) after `tests/db/supabase-stub.sql`
  emulates Supabase's roles, `auth` schema and default grants. They exercise the
  RPC rules and RLS policies with allowed and denied cases (the goal in
  ARCHITECTURE section 8 is every rule). No Docker and no network. The first run
  takes a minute while PGlite boots.
- **CI** (`.github/workflows/ci.yml`) runs lint, typecheck, all tests and a
  production build with placeholder env on every push to `main` or `release/**`
  and on every pull request.
- **Live smoke** (`scripts/smoke/live-smoke.mjs`) against the real project, by hand.
- There are no browser end-to-end tests yet (see the backlog).

## 7. Known limitations

- **No email at all.** No confirmation emails, no self-service password reset.
  Admins reset passwords (temporary password plus a forced change).
- **Push on iPhone** works only when the app is installed to the home screen
  (iOS 16.4 or later) and alerts are allowed. A push that fails is not retried.
  The in-app alert is always there.
- **Supabase free plan:** the project pauses after about a week without
  activity (the keepalive prevents this), has small database and bandwidth limits,
  and has no automatic daily backups. Upgrade to Pro before the department
  relies on it (`docs/DEPLOY.md`).
- **Vercel Hobby:** cron jobs run at most once a day.
- **Calendar subscriptions** refresh when the calendar app decides (Apple about
  hourly to daily; Google can take a day or more). The feed covers 30 days
  back to 365 days ahead.
- **v1 scope:** no overtime, C-Watch, EMS/ambulance shifts, SMS, or native app
  store builds. Picked-up days can't be re-traded. Shifts can be posted up to 180
  days out. Trades are same rank only.
- **TeleStaff is not connected.** Members still enter trades there themselves.
- **Realtime** events only trigger a refetch; if the websocket drops, pages
  refresh on focus or navigation.

## 8. Backlog ideas

- Browser end-to-end tests (Playwright) for sign-up, post, request, confirm and cancel.
- Error monitoring (e.g. Sentry) and an uptime check with SMS alerts.
- Optional email or SMS alerts and self-service password reset (needs an email provider).
- Re-trading picked-up shifts; multi-person trade chains.
- A TeleStaff-ready export or "copy for paperwork" improvements.
- Overtime and C-Watch boards (out of scope for v1).
- Admin reports: trades per battalion, members with large balances.
- A custom domain.
- Upgrade Supabase to Pro for backups and headroom once usage grows.
