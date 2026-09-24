# SFFD ShiftSwap

ShiftSwap is a shift-trading app for San Francisco Fire Department (fire side)
members. A member posts one of their own shifts, other members of the same rank
ask to cover it, and the poster picks one. That makes a trade. The app keeps
everyone's calendar, trade balances and alerts up to date.

ShiftSwap is an **unofficial coordination tool**. TeleStaff is still the
official schedule, and every trade still needs approval the normal SFFD way.
Every member acknowledges this once, the first time they use the app.

- Live app: <https://sffd-shiftswap.vercel.app> (v1, deployed from the
  `release/v1` branch with the Vercel CLI)
- Built for phones. Most members install it on the home screen (iPhone or Android).

## Features

- **Membership by roster.** New sign-ups that match the department roster are
  approved automatically. Everyone else waits in an admin queue, with their phone
  and email so an admin can reach them.
- **Calendar.** Each member's work days are worked out from their tour number
  (the SFFD 31-day rotation), then adjusted for trades. The colors show your tour
  days, days you gave away, shifts you picked up, SwapMatch days and open shifts
  you could take.
- **Board.** Open shifts, filtered to your battalion and rank by default, with a
  "Only shifts I can take" switch.
- **Post a shift.** Choose one of your tour days (24-Hour or PM), the location,
  who may take it (anyone, your division, battalion or station) and a note.
- **SwapMatch.** Offer up to 10 dates you could work in return. The member who
  takes your shift picks one, and both trades are recorded together.
- **Request, then confirm.** Many members can ask for a shift. The poster
  confirms one, and everyone else is told politely that it was filled.
- **Backing out needs both people.** Either person can ask to cancel a
  confirmed trade before it starts. The other person agrees or declines. Admins
  can void any trade.
- **Trades and balances.** Pending, confirmed and past trades, plus who owes
  whom, per person and per shift type ("Mike owes you 1 × 24-Hour").
- **Chat and contact.** One-to-one chat on each trade, plus tap-to-call or text
  your trade partner. Phone numbers are only shown to trade partners.
- **Alerts.** In-app alerts plus push notifications on phones and computers,
  with a setting for which new shifts you want to hear about.
- **Calendar subscription.** A private link that adds your ShiftSwap days to
  Apple Calendar, Google Calendar or Outlook.
- **Works offline.** When there is no signal, the app shows the last calendar,
  board and trades it saw, with a yellow "Offline snapshot" ribbon.
- **Admin tools.** Approvals, members (edit, suspend, make admin, reset
  password, remove an account when a member asks), roster CSV upload, trade
  oversight (take down posts, void trades, CSV export) and an activity log.

## Tech stack

| Part | What we use |
|---|---|
| Web app | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Styling | Tailwind CSS v4, dark theme, Bebas Neue and DM Sans fonts, `lucide-react` icons |
| Forms | `react-hook-form` and `zod` v4 |
| Database, sign-in and live updates | Supabase (Postgres, Auth, Realtime) through `@supabase/ssr` and `@supabase/supabase-js` |
| Push notifications | Web Push (`web-push`, VAPID keys) and a service worker (`public/sw.js`) |
| Hosting | Vercel. The database is a Supabase project added through the Vercel Marketplace. |
| Tests | Vitest. Database tests run the real migrations in PGlite (Postgres in WebAssembly), so Docker is not needed. |
| CI | GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, tests and build on every push to `main` or `release/**` and on every pull request |

`docs/ARCHITECTURE.md` is the full design and build contract.

## Local development

You need Node 22 (Node 20.9 or newer works) and the
[Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`).

```sh
npm ci                       # install exact dependency versions
vercel link                  # once: connect this folder to the sffd-shiftswap project
vercel env pull .env.local   # download the environment variables (never commit this file)
npm run dev                  # http://localhost:3000
```

`vercel env pull` gives you the real Supabase database. Anything you do locally
changes real data, so test with throwaway accounts and clean up afterwards.

Push alerts only work over HTTPS or on `localhost`, and only after you allow
notifications in the browser.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Production build, then serve it |
| `npm run check` | Lint, typecheck and run every test (run this before every commit) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm test` | All tests (unit and database) |
| `npm run test:unit` | Unit tests only (`tests/unit`) |
| `npm run test:db` | Database tests only (`tests/db`, migrations applied in PGlite) |
| `npm run db:migrate` | Apply new migrations in `supabase/migrations` to the database in `.env.local`. Add `-- --status` to list them or `-- --dry-run` to preview. |
| `node scripts/db/make-admin.mjs <email>` | Make an existing member an approved admin (for the very first admin; after that, use Admin ▸ Members) |
| `node scripts/db/set-app-config.mjs key=value` | Set database settings, e.g. the push webhook (see `docs/DEPLOY.md`) |
| `node scripts/smoke/live-smoke.mjs` | End-to-end smoke test against the real database with throwaway members, cleaned up afterwards |
| `node scripts/smoke/ui-tour.mjs` | Phone-sized screenshot tour of every screen on the live app (Playwright) with throwaway members, cleaned up afterwards. Screenshots go to `.tmp-test/shots/`; `--base <url>` tours another deployment. |

The database scripts read `POSTGRES_URL_NON_POOLING` from `.env.local`. They
never print passwords or keys.

## Environment variables

On Vercel, the Supabase integration sets the Supabase values automatically. You
add the push values yourself (see `docs/DEPLOY.md`).

| Name | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser and server | Set by the Vercel ↔ Supabase integration |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | browser and server | Public key. Either name works. |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | server only | Sign-up, admin password resets, closing a removed member's login, push delivery. Never expose it. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | browser and server | Web Push public key |
| `VAPID_PRIVATE_KEY` | server only | Web Push private key |
| `VAPID_SUBJECT` | server only | Contact for push services, e.g. `mailto:you@example.com` |
| `PUSH_WEBHOOK_SECRET` | server only | Shared secret for the database push webhook (the same value goes in the database's `push_webhook_secret` setting) |
| `POSTGRES_URL_NON_POOLING` (or `DATABASE_URL`) | local scripts only | Direct database connection for migrations and admin scripts |

If the Supabase values are missing, pages say so clearly instead of crashing,
and `/offline`, `/privacy` and `/api/keepalive` keep working. If the VAPID
values are missing, push alerts are skipped and everything else still works.

## Deployment

- **Preview first, then production.** The GitHub repository is not connected
  to Vercel, so pushing or merging deploys nothing. From an up-to-date clone of
  `release/v1`, deploy a preview (`vercel deploy`), check it, then promote it
  or run `vercel deploy --prod`. Production is
  <https://sffd-shiftswap.vercel.app>.
- **Database changes** are new files in `supabase/migrations/`. Apply them with
  `npm run db:migrate` before (or together with) the deploy that needs them.
  Never edit a migration that has already been applied.
- **Keepalive.** A daily Vercel cron and a daily GitHub Action call
  `/api/keepalive`, so the free Supabase database is never paused for being idle.
  If the check fails, GitHub emails the owner.

The step-by-step guide, rollback and monitoring are in `docs/DEPLOY.md`.

## Documentation

| Document | For |
|---|---|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | Firefighters: install the app, post, request, confirm, back out, alerts, calendar |
| [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) | Admins: approvals, roster, passwords, suspending, removing accounts, trades, activity log, when the app is down |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deploying, environment variables, migrations, push webhook, rollback, monitoring |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The design and build contract (database, rules, routes, UX) |
| [HANDOFF.md](HANDOFF.md) | The next developer or AI agent: current state, services, how things fit together |
| [supabase/README.md](supabase/README.md) | The database migrations and the rules that are easy to miss |
| [AGENTS.md](AGENTS.md) | Rules for AI coding agents working in this repository |
