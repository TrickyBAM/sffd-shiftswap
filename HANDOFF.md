# SFFD ShiftSwap — Handoff Report

A shift-trading web app for San Francisco Fire Department firefighters. This document is written for an AI agent (or developer) picking up the project cold.

---

## 1. Project at a glance

- **Owner:** Brian Machado (SFFD firefighter, GitHub `TrickyBAM`)
- **Goal:** let SFFD firefighters post shifts they can't work, accept other firefighters' shifts, and track their trade balance.
- **Production URL:** https://sffd-shiftswap.vercel.app
- **GitHub:** https://github.com/TrickyBAM/sffd-shiftswap (branch: `main`)
- **Local path:** `/Users/teslamac/sffd-shiftswap`
- **Status:** end-to-end MVP deployed. Auth + profile onboarding + schedule detection + shift board + post/cancel + notifications are wired. Currently blocked on a user-side login issue (see §10).

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16.2.1** (App Router, Turbopack) |
| UI | React 19, Tailwind CSS, custom design tokens |
| Forms | react-hook-form + zod v4 |
| Auth + DB | Supabase (`@supabase/ssr` v0.9) |
| Hosting | Vercel |
| Fonts | Bebas Neue (display), DM Sans (body) — loaded from Google Fonts in `app/layout.tsx` |

> ⚠️ **Read `AGENTS.md` before writing code.** It says: "This is NOT the Next.js you know. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."

## 3. Service IDs / credentials

| Service | ID / URL |
|---|---|
| Vercel project ID | `prj_bu8GRjkHNirIdE1hqvMe5LlUpFEy` |
| Vercel team ID | `team_9KHmhLMjNKAUp6suv3umdjdl` |
| Vercel project name | `sffd-shiftswap` |
| Supabase project ref | `mddpdrkxexxpyneqmxfi` |
| Supabase URL | `https://mddpdrkxexxpyneqmxfi.supabase.co` |
| Anon key | in `.env.local` (also configured in Vercel env) |

The anon key is committed in `.env.local` (it's a public anon key, fine to expose). The service role key is **not** stored locally — Brian has it in the Supabase dashboard.

## 4. File structure (src/)

```
src/
├── middleware.ts                    # Wraps updateSession (lib/supabase/middleware.ts)
├── app/
│   ├── layout.tsx                   # Root layout, fonts, global styles
│   ├── page.tsx                     # / → redirects to /login or /dashboard
│   ├── globals.css                  # Design tokens, fadeInUp keyframes
│   ├── (auth)/                      # Route group: unauth pages
│   │   ├── layout.tsx               # Centered card layout
│   │   ├── login/page.tsx           # Email + password, signInWithPassword
│   │   ├── signup/page.tsx          # Email + password + full_name
│   │   ├── verify-email/page.tsx    # "Check your inbox" landing
│   │   ├── onboarding/page.tsx      # SFFD division/battalion/station/rank/tour
│   │   └── auth/callback/route.ts   # OAuth/magic-link callback, routes to onboarding|schedule-setup|dashboard
│   ├── (app)/                       # Route group: authed + profile_complete + schedule.setup_complete
│   │   ├── layout.tsx               # Auth + profile + schedule guard, ProfileProvider
│   │   ├── dashboard/page.tsx       # Calendar with work days, posted shifts, trade score banner
│   │   ├── shift-board/page.tsx     # All open shifts; user's own get a Cancel button
│   │   ├── post-shift/page.tsx      # Form to create a Shift row
│   │   ├── profile/page.tsx         # Profile info, "Recalibrate Schedule", Sign Out
│   │   └── notifications/page.tsx   # Notifications list (real-time subscription)
│   └── schedule-setup/              # OUTSIDE (app) on purpose — see §6
│       ├── layout.tsx               # Auth + profile guard ONLY (no schedule check, avoids redirect loop)
│       └── page.tsx                 # 3-step wizard: pick days → confirm prediction → done
├── components/
│   └── Navigation.tsx               # Bottom tab bar (glassmorphic, 5 items, raised Post button)
├── contexts/
│   └── ProfileContext.tsx           # Provides Profile to (app) tree
└── lib/
    ├── supabase/{client,server,middleware}.ts   # @supabase/ssr factories
    ├── schedule.ts                  # Pattern detection algorithm — see §7
    ├── tours.ts                     # Legacy 31-tour rotation utilities (mostly unused after schedule rewrite)
    ├── sffd.ts                      # SFFD division → battalion → station data for cascading dropdowns
    └── types.ts                     # Profile, Shift, Schedule, Notification, etc.
```

## 5. Database schema (Supabase / Postgres)

All tables have RLS enabled. Policies: users can read their own rows, plus shifts/profiles are readable by all authenticated users for the shift board.

### `profiles`
- `id uuid` (FK → auth.users, cascade delete) PK
- `full_name text`, `email text`
- `rank text`, `position_type text`
- `tour int`, `division int`, `battalion int`, `station int`
- `phone text` (nullable)
- `trade_requested int`, `trade_filled int`, `trade_outstanding int`, `trade_earned int` (default 0)
- `profile_complete bool` (default false)
- `created_at`, `updated_at` timestamptz

**Trigger:** `handle_new_user()` runs `AFTER INSERT ON auth.users` → inserts a profile row with safe defaults. **The original CHECK constraint on `division IN (2,3)` was dropped** because the trigger inserts a placeholder before onboarding sets the real division. Be careful re-adding any CHECK constraints to columns the trigger pre-fills.

### `shifts`
- `id uuid` PK, `poster_id uuid` (FK profiles), `poster_name text`
- `division int`, `battalion int`, `station int`, `rank text`
- `date date`, `shift_type text`
- `status text` — `'open' | 'covered' | 'cancelled'`
- `return_dates date[]`, `accept_limit_type text` ('' | 'station' | 'battalion' | 'division')
- `coverer_id`, `coverer_name`, `notes`
- `created_at`, `updated_at`

**RPC:** `accept_shift(shift_id uuid)` — atomic accept, updates shift + both users' trade counters.

### `schedules`
- `id uuid` PK
- `user_id uuid` UNIQUE (FK profiles, cascade)
- `work_dates date[]` — raw user-tapped days
- `gap_pattern int[]` — detected cycle (e.g. `[2,4,1,4,2,4,...]`)
- `anchor_date date` — first work day, used to project forward/backward
- `setup_complete bool` (default false)
- `created_at`, `updated_at`

### `notifications`
- `id uuid` PK, `user_id`, `type`, `title`, `message`, `shift_id`, `related_user_id`, `read bool`, `created_at`
- Real-time subscription used in `notifications/page.tsx`.

### `matched_trades`
- Used for SwapMatch (auto-pairing posters whose return dates align). Not heavily exercised in MVP.

## 6. Routing model

Three groups, two layouts that gate access:

1. **`(auth)`** — login, signup, verify-email, onboarding, auth callback. Unauth-friendly.
2. **`(app)`** — gated by `(app)/layout.tsx`:
   - if no user → redirect `/login`
   - if no profile or `profile_complete=false` → redirect `/onboarding`
   - if no schedule or `setup_complete=false` → redirect `/schedule-setup`
3. **`/schedule-setup`** — *standalone, outside both groups*. Its layout checks auth + profile but **deliberately does not check schedule**, otherwise we'd redirect-loop into ourselves. Don't move it back inside `(app)`.

`src/lib/supabase/middleware.ts` handles top-level auth: redirects unauth users from protected paths to `/login`, and authed users away from auth pages to `/dashboard`.

## 7. Schedule pattern detection (`src/lib/schedule.ts`)

SFFD runs a 31-day rotation that produces ~9 work days per cycle, with non-uniform gaps. We don't ask the user to enter "platoon" or "tour number" — we ask them to mark the days they worked on a calendar, then detect the cycle.

Algorithm:
1. Sort `work_dates`, compute consecutive gaps.
2. Try cycle lengths 2 through min(gaps.length, 12).
3. For each length, fold the gaps into that cycle, score how well the folded pattern predicts the original sequence (Occam bonus for shorter cycles).
4. Pick the highest-scoring pattern; store as `gap_pattern`.

Key exports:
- `detectSchedulePattern(workDates)` → `{ gapPattern, confidence, anchorDate }`
- `getWorkDatesForMonth(anchorDate, gapPattern, year, month)` — used by the dashboard calendar
- `projectSchedule()`, `projectScheduleBackward()` — extrapolate
- `refinePattern(month1Dates, month2Dates)` — combine two months for better accuracy after the user corrects the wizard's prediction in step 2

The wizard at `/schedule-setup` is the only place users interact with this. After Brian corrects month-2, we call `refinePattern` and save the better pattern.

## 8. Design system

Set in `globals.css` and applied across all pages. From the most recent design overhaul commit (`cd1243c`):

- Colors: `--bg-primary #0a0a0f`, `--bg-card #12121a`, `--sffd-red #D32F2F`, `--accent-orange #FF6B35`, `--accent-blue #4A9FFF`, `--accent-purple #9C6AFF`, `--text-primary #F0F0F5`, `--text-secondary #8888A0`, `--text-dim #555570`, borders `rgba(255,255,255,0.06)`
- Fonts: Bebas Neue (`.font-display`) for headers, DM Sans for body
- Cards: `bg-[#12121a]`, `rounded-2xl`, `border border-white/[0.06]`, hover lift
- Animations: `fadeInUp` keyframes with staggered `animation-delay`
- Bottom nav: glassmorphic, raised center Post button with red glow

If you redesign anything, **stay inside this token system** — Brian explicitly approved this look.

## 9. How to run / deploy

```bash
# Local dev (port 3004 in launch.json)
cd /Users/teslamac/sffd-shiftswap
npm run dev

# Deploy
git push origin main           # auto-deploys via Vercel GitHub integration
# OR manual:
npx vercel --prod
```

Preview tooling: `.claude/launch.json` (in `~/.claude/`) defines a `shiftswap` server on port 3004. Use `mcp__Claude_Preview__preview_*` tools with that name.

For Supabase SQL changes Brian opens the SQL editor in Chrome (project ref `mddpdrkxexxpyneqmxfi`) and pastes statements. There is no migrations directory — schema lives only in Supabase. Document any new SQL you run by pasting it into a commit message or this file.

## 10. Recent fixes (chronological, most recent first)

1. **Design system overhaul** (`cd1243c`, `8c906c9`) — Bebas Neue + DM Sans, dark token palette, glassmorphic nav, fadeInUp animations. Applied across all pages including onboarding.
2. **Cancel/delete shift** (`863d146`) — user's own posted shifts now show a "Cancel Shift" button on both the dashboard popup and the shift board card. Confirms before cancelling, sets `status='cancelled'`, decrements `trade_requested` and `trade_outstanding`.
3. **`profiles_division_check` constraint dropped** — the `handle_new_user` trigger was inserting a default division that violated the CHECK (only 2 or 3 allowed). Fix: dropped the constraint entirely. Real division is set during onboarding.
4. **Schedule setup feature** (`2ed2df3`) — pattern detection wizard, `schedules` table, dashboard calendar uses `getWorkDatesForMonth`, profile page has Recalibrate button.
5. **Initial build** (`81ab600`) — full app skeleton, auth, onboarding, shift CRUD, notifications.

## 11. Current open issue

**Brian can't log in to his own account.** Diagnostics run on 2026-04-26:

- ✅ Vercel deployment is `READY`, latest commit `8c906c9` deployed.
- ✅ Supabase REST returns 401 (expected — needs auth), `/auth/v1/health` returns 200, `/auth/v1/settings` shows email enabled, signup not disabled.
- ✅ Reproduced login form locally against live Supabase: signup works (200), login with unconfirmed account returns "Email not confirmed" exactly as designed.
- ⚠️ Vercel runtime logs show `[Ct [AuthUnknownError]: Une...` on GET /login (200) and /dashboard (307). Request status is fine — this is `@supabase/ssr` logging an internal warning when it tries to refresh a stale session cookie. **Most likely cause: Brian's browser has a stale Supabase cookie from before the project was paused.**

**Next agent to-do:** ask Brian for the email he uses, then either (a) trigger a password reset via Supabase, or (b) inspect the user row in `auth.users` (needs service role key from Brian) to see if `email_confirmed_at` is null — if so, either manually confirm or disable the email-confirmation requirement. The simplest fix is usually "clear cookies for sffd-shiftswap.vercel.app or use Incognito, then log in fresh."

The "AuthUnknownError" log noise itself is harmless. If you want to silence it, wrap `supabase.auth.getUser()` in `src/lib/supabase/middleware.ts` in a try/catch and treat any thrown error as `user = null`.

## 12. Things NOT yet built

- **SwapMatch UI polish** — `matched_trades` table exists but the UI to surface auto-matches is minimal.
- **Push/email notifications** — only in-app notifications work. No real-time email or push.
- **Admin tools** — no way to ban a user, force-cancel a shift, or audit trade balances. Brian eventually wants this.
- **Mobile-app wrapper** — currently a responsive PWA-shaped web app. No native shell.
- **Production SMTP** — Supabase free-tier shared SMTP is unreliable. Plug in SendGrid/Resend before scaling beyond Brian's testing circle.
- **Tests** — no test suite. `npm run build` is the only correctness gate.

## 13. Working with Brian

- Communicates in plain English; expects agents to test their own work end-to-end.
- "Build it, test it, push it, deploy it" is his default expectation.
- He's a firefighter, not a developer. Don't dump code at him — show outcomes (live URLs, screenshots, what works).
- He's on Vercel + Anthropic paid plans. Cost is not a constraint within reason.

## 14. Useful commands cheat-sheet

```bash
# Vercel
npx vercel --prod                                    # deploy
npx vercel logs sffd-shiftswap.vercel.app           # tail logs

# Git
git log --oneline -20
git push origin main

# Supabase auth probe (no service role needed)
curl -sS "https://mddpdrkxexxpyneqmxfi.supabase.co/auth/v1/health" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"

# Trigger password reset for a user
curl -sS -X POST \
  "https://mddpdrkxexxpyneqmxfi.supabase.co/auth/v1/recover" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"USER_EMAIL"}'
```

---

*Generated 2026-04-26. If the date on this file is more than a few weeks old, run `git log --oneline -10` and reconcile §10 / §11 against actual recent commits before trusting them.*
