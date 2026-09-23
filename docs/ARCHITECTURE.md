# SFFD ShiftSwap v1 — Architecture & Build Contract

This document is the single source of truth for the v1 rebuild (branch `release/v1`).
Every implementer (human or AI) follows it. If you must deviate, update this file in
the same change and say why.

---

## 0. Product in one paragraph

ShiftSwap lets San Francisco Fire Department (fire-side) members trade shifts. A member
**posts** one of their own shifts; eligible members **request** it (optionally proposing a
SwapMatch return date); the poster **confirms** one request, which makes a **trade**. A
trade can be undone only if **both parties agree** (or an admin voids it). Membership is
gated: people sign up, and are **auto-approved when they match the department roster**,
otherwise an **admin approves** them. Each member's work schedule is computed from their
**tour number** (SFFD 31-day rotation). The app is an **unofficial coordination tool**:
TeleStaff remains the official system of record and trades still need approval per SFFD
policy — every member acknowledges this once.

Owner/admin: Brian Machado (SFFD firefighter, not a developer). Audience: firefighters on
phones, often installed as a PWA on iPhone.

## 1. Decisions (from the owner, 2026-09-23 — do not change without asking)

| Topic | Decision |
|---|---|
| Hosting | Vercel (existing project `sffd-shiftswap`). Database = Supabase provisioned via the Vercel Marketplace (Storage tab), fresh database, free tier initially. |
| Membership | Roster match ⇒ auto-approve. No match ⇒ `pending`, admins notified with the applicant's phone/email to reach out. |
| Accept flow | **Request → poster confirms.** Many members may request; poster picks one; others auto-declined with a polite notice. |
| Back out | **Both must agree.** Either party may *ask* to cancel a confirmed trade before it starts; the other party agrees or declines. Admins can void any trade. |
| Email | **None at launch.** No email confirmation. Accounts are created server-side already confirmed. Forgotten passwords are reset by an admin (temporary password + forced change). |
| Ranks | Firefighter, Paramedic, Lieutenant, Captain, Battalion Chief, Division Chief. **Same rank only.** Fire side only (no EMS division, no ambulance shifts). |
| Shift types | `24-Hour` = 08:00 → 08:00 next day (24 h). `PM` = 16:00 → 08:00 next day (16 h). Dates are stored as the **start date**. |
| Official approval | Stays outside the app (TeleStaff). First-launch acknowledgment required. |
| Out of scope v1 | Overtime, C-Watch, EMS/ambulance, email/SMS, native app store builds. |

Brian's Nov-2025 spec (Google AI Studio "SFFD ShiftSwap App Details") is the UX reference:
five tabs **Calendar · Board · Post · Trades · Profile**; board defaults to **My Battalion**;
calendar colors (see §7.2); 1:1 chat; trust score; TeleStaff notice; offline snapshot ribbon.

## 2. Stack

- Next.js **16.3.x** App Router (Turbopack). **Read `node_modules/next/dist/docs/` before using
  any Next API you are unsure about** — this version differs from older training data
  (e.g. middleware is `src/proxy.ts` exporting `proxy()`; `cookies()`/`headers()`/`params`
  are async).
- React 19, Tailwind CSS v4 (tokens in `src/app/globals.css`), `lucide-react` icons,
  `react-hook-form` + `zod` v4 for forms, `date-fns` v4 only for display formatting.
- Supabase: Postgres + Auth + Realtime via `@supabase/ssr` 0.12 / `@supabase/supabase-js` 2.117.
- Web Push via `web-push` (VAPID). Service worker at `public/sw.js`.
- Tests: `vitest` (unit + database). Database tests run the real migrations inside
  **PGlite** (Postgres 18 in WASM) with a Supabase stub — no Docker required.

## 3. Time & dates (read this — most bugs live here)

- A "date" is a **plain `YYYY-MM-DD` string** meaning a calendar day in
  **America/Los_Angeles**. Never pass a date string to `new Date()` (it parses as UTC and
  shifts a day in California). Use the helpers in `src/lib/sffd/dates.ts`:
  `todayPT()`, `addDays(ymd, n)`, `diffDays(a, b)`, `ymdToDayNumber(ymd)`,
  `dayNumberToYmd(n)`, `dayOfWeek(ymd)`, `monthGrid(year, month)`, `formatDate(ymd, style)`.
  These use integer day numbers computed with `Date.UTC`, so they are timezone-independent.
- Shift start instant: `starts_at = (date + start_time) AT TIME ZONE 'America/Los_Angeles'`
  where start_time is 08:00 (24-Hour) or 16:00 (PM). Computed in SQL by
  `public.shift_starts_at(date, shift_type)` and stored on the row.
- "Started"/"past" = `starts_at <= now()`. Nothing can be posted, requested, confirmed or
  cancelled (by members) once started.

## 4. SFFD tour rotation

Verified against the public per-tour calendars linked from sffirecu.org and the Local 798 MOU
(24-h shifts, 31-day tour of duty, 48.7-h average week).

- Epoch: **2019-01-01 is Watch 1**. `watch(d) = mod(daysBetween(2019-01-01, d), 31) + 1`.
- **Tour 1 works watches {1,4,7,11,14,17,21,24,27}** → offsets `OFFSETS = [0,3,6,10,13,16,20,23,26]`.
- **Tour N = Tour 1 shifted by N−1 days.** `tourWorks(N, d) = OFFSETS.includes(mod(daysBetween(2019-01-01, d) − (N−1), 31))`.
- Every calendar day exactly 9 of the 31 tours are on duty. Each tour works 9 shifts per 31 days.
- Sanity check: 2026-09-23 is Watch 2; tours on duty that day are {2,7,10,13,17,20,23,27,30}.
- Members not on a numbered tour (relief, detail, 40-hour) set **tour = null** ("No tour"): the
  app skips base-schedule checks for them and they post specific dates.
- Implemented twice and tested against each other: `src/lib/sffd/tours.ts` and SQL
  `public.tour_works(smallint, date)`. `tests/unit/tours.test.ts` checks both against a fixture.

**Effective schedule** for member *u* on date *d* (corrected in migration `0011`, TF-1):
```
base        = u.tour is not null and tour_works(u.tour, d)
givenAway   = exists covered shift with poster_id = u and date = d   (either type)
pmGivenAway = that covered shift is a PM: u still works 0800–1600
pickedUp    = exists covered shift with coverer_id = u and date = d
working     = (base and not givenAway) or pmGivenAway or pickedUp
```
Only giving away a **24-Hour** frees the day. A PM (16:00–08:00) is the second part of a
24-hour tour day, so after giving away only the PM the member is still on duty 0800–1600:
the day stays red on the calendar and they can't pick up another shift that day
(`YOU_WORK_THAT_DAY`). This holds for no-tour members too. In SQL: `public.gave_away` counts
24-Hour give-aways only, `private.gave_away_pm` the PM ones; `effective_works`,
`private.works_own_shift` and `my_schedule` use them. Client mirror:
`src/lib/schedule/effective.ts` (`ScheduleDay.pmGivenAway`, `dutyHours()`, `dutySummary()`).
(`covered` includes SwapMatch return legs, which are ordinary covered shift rows.)

## 5. Organisation data

`src/lib/sffd/stations.ts` and the `public.stations` table hold the same data (verified against
sf-fire.org). Division 2: B1 [2,13,28,41], B4 [3,16,38,51], B5 [5,10,12,21], B7 [14,22,31,34],
B8 [18,20,23,40]. Division 3: B2 [1,6,29,36], B3 [4,8,35,48], B6 [7,11,24,26,32],
B9 [15,19,33,39,43], B10 [9,17,25,37,42,44]. Airport Division (id 4): Battalion 99
[101,102,103] labelled "Airport Station 1–3". Picking a station always determines battalion
and division (never stored independently from user input).

Ranks (ordered): `Firefighter, Paramedic, Lieutenant, Captain, Battalion Chief, Division Chief`.
Shift types: `24-Hour` (24 h, starts 08:00), `PM` (16 h, starts 16:00).

## 6. Database (Supabase Postgres)

Migrations live in `supabase/migrations/NNNN_name.sql`, applied in filename order by
`scripts/db/migrate.mjs` (records applied files in `private.schema_migrations`). The same
files are applied by the PGlite test harness. The old `schema-backup.sql` and the two July
migrations are superseded and moved to `supabase/archive/`.

Conventions:
- All app objects in schema `public`; internal config in schema `private` (not exposed to the API).
- Every function: `security definer` **only when required**, always `set search_path = ''`
  with fully-qualified names (`public.x`, `auth.uid()`).
- Supabase grants ALL on new public tables/functions to `anon`/`authenticated` by default.
  Migrations therefore **explicitly** `revoke all ... from anon, authenticated, public` and then
  grant only what is listed below. Tests assert this.
- RLS enabled (and `force row level security` not required) on every public table.
- Errors: RPCs `raise exception '<friendly message>' using errcode = 'P0001', hint = '<CODE>'`.
  The client shows `message` to the user and may branch on `hint` (see §6.6).

### 6.1 Tables

**stations** `(station int pk, battalion int not null, division int not null, label text not null, sort int not null)` — seeded; read-only.

**profiles** — one per auth user (created by trigger on `auth.users` insert).
```
id uuid pk references auth.users on delete cascade
email text not null default ''
full_name text not null default ''            -- 2..80 chars once onboarded
phone text                                    -- required at onboarding (digits/+,-,(), space; 7..20)
rank text check (rank in ranks)               -- null until onboarding
station int references stations               -- null until onboarding
battalion int, division int                   -- derived from station by RPCs only
tour smallint check (tour between 1 and 31)   -- null = no tour
employee_id text                              -- optional; only self/admins can read
status text not null default 'onboarding'     -- onboarding|pending|approved|rejected|suspended
status_reason text
role text not null default 'member'           -- member|admin
roster_id uuid unique references roster on delete set null
telestaff_ack_at timestamptz
must_change_password boolean not null default false
notify_scope text not null default 'battalion' -- off|station|battalion|division|all (new-shift alerts)
calendar_token uuid not null default gen_random_uuid() unique
approved_at timestamptz, approved_by uuid references profiles
removed_at timestamptz                        -- 0011: set by admin_remove_member; check: removed ⇒ status 'suspended'
created_at, updated_at timestamptz not null default now()
```

**roster** — department list uploaded by admins.
```
id uuid pk, first_name text not null, last_name text not null,
first_key text not null, last_key text not null   -- public.name_key(first/last), set by import
employee_id text, rank text, station int references stations, tour smallint, email text, phone text,
claimed_by uuid unique references profiles on delete set null,
created_by uuid references profiles, created_at timestamptz default now()
```
`public.name_key(text)`: lowercase, strip accents where possible, keep only a–z, collapse →
e.g. "O'Brien-Smith" → "obriensmith". Mirrored by `src/lib/roster/normalize.ts`.

**shifts** — a posted shift and, once confirmed, the trade record.
```
id uuid pk default gen_random_uuid()
poster_id uuid not null references profiles     -- whose shift it is (the one who owes)
poster_name text not null                       -- snapshots taken by RPC
rank text not null, station int not null references stations, battalion int not null, division int not null
date date not null, shift_type text not null check in ('24-Hour','PM')
hours smallint not null                         -- 24 or 16
starts_at timestamptz not null
status text not null default 'open'             -- open|covered|cancelled
return_dates date[] not null default '{}'       -- SwapMatch offers (0..10), distinct, sorted
accept_limit text not null default 'anyone'     -- anyone|division|battalion|station (relative to the shift's station)
notes text                                      -- <= 500 chars
coverer_id uuid references profiles, coverer_name text, confirmed_at timestamptz
return_leg_of uuid references shifts            -- set on the auto-created SwapMatch return leg
return_leg_id uuid references shifts            -- set on the original when a SwapMatch is confirmed
cancel_requested_by uuid references profiles, cancel_requested_at timestamptz, cancel_reason text
cancelled_at timestamptz, cancelled_by uuid references profiles, cancel_note text
created_at, updated_at
```
Constraints / indexes:
- `check (coverer_id is null or coverer_id <> poster_id)`
- `check ((status = 'covered') = (coverer_id is not null))`
- `check (cardinality(return_dates) <= 10)`
- partial unique `(poster_id, date) where status in ('open','covered')` — can't give a day away twice.
- partial unique `(coverer_id, date) where status = 'covered'` — can't cover two shifts the same day.
- indexes on `(status, date)`, `(battalion, date)`, `poster_id`, `coverer_id`, `return_leg_of`.

A **SwapMatch** = original shift with `return_dates` offered. When the poster confirms a
request that carries a `return_date`, the RPC creates a **return leg**: a new `shifts` row with
`poster_id = requester`, `coverer_id = original poster`, `date = return_date`, same `shift_type`,
status `covered`, `return_leg_of = original.id`, snapshots from the requester's profile; and
sets `original.return_leg_id`. Both legs are ordinary covered shifts, so balances net to zero
and calendars need no special casing. Return legs never go back to `open`.

**shift_requests**
```
id uuid pk, shift_id uuid not null references shifts on delete cascade,
requester_id uuid not null references profiles,
requester_name text not null, requester_rank text not null, requester_station int not null,
return_date date,                   -- required iff the shift offers return_dates; must be one of them
message text,                       -- <= 300
status text not null default 'pending'  -- pending|accepted|declined|withdrawn|cancelled
decided_at timestamptz, created_at timestamptz default now()
unique (shift_id, requester_id) where status = 'pending'
```

**messages** — 1:1 chat about a shift between the poster and one other member who has a
request on it or is its coverer.
```
id uuid pk, shift_id uuid not null references shifts on delete cascade,
sender_id uuid not null references profiles, recipient_id uuid not null references profiles,
body text not null (1..1000), read_at timestamptz, created_at timestamptz default now()
```

**notifications**
```
id uuid pk, user_id uuid not null references profiles on delete cascade,
type text not null, title text not null, body text not null,
url text not null default '/trades',          -- in-app deep link
shift_id uuid references shifts on delete set null, actor_id uuid references profiles on delete set null,
read_at timestamptz, pushed_at timestamptz, created_at timestamptz default now()
```
Types: `request_received, request_accepted, request_declined, request_withdrawn, post_cancelled,
cancel_requested, trade_cancelled, cancel_declined, trade_voided, new_shift, message,
member_pending, member_auto_approved, member_approved, member_rejected, account_status`.

**push_subscriptions** `(id uuid pk, user_id uuid not null references profiles on delete cascade, endpoint text unique not null, p256dh text not null, auth text not null, user_agent text, created_at, last_success_at)`

**audit_log** `(id bigint generated always as identity pk, actor_id uuid, action text not null, target_type text, target_id uuid, details jsonb not null default '{}', created_at timestamptz default now())`

**private.signup_attempts** `(id bigint identity pk, ip_hash text not null, created_at timestamptz default now())` — service role only.
**private.app_config** `(key text pk, value text not null)` — e.g. `push_webhook_url`, `push_webhook_secret`.
**private.schema_migrations** `(filename text pk, applied_at timestamptz default now())`.

### 6.2 Row Level Security & grants (authenticated role; anon gets nothing except §6.5)

| Table | select | insert | update | delete |
|---|---|---|---|---|
| stations | everyone authenticated | – | – | – |
| profiles | own row; admins all | – (trigger) | – (RPC only) | – |
| roster | admins | – (RPC) | – | admins |
| shifts | approved members | – (RPC) | – (RPC) | – |
| shift_requests | requester, the shift's poster, admins | – | – | – |
| messages | sender or recipient | – (RPC) | recipient may set `read_at` only (column grant) | – |
| notifications | own | – | own, `read_at` only (column grant) | own |
| push_subscriptions | own | own | – | own |
| audit_log | admins | – | – | – |

Helper functions (security definer, stable): `public.is_approved()`, `public.is_admin()`.
A suspended/rejected/pending member is not "approved" and therefore sees no shifts.
Other members' phone/email are **never** readable directly; they are exposed only through
`get_trade_contact()` to trade partners (§6.3).

### 6.3 RPC API (all `security definer`, execute granted to `authenticated` only unless noted)

Every RPC first checks `auth.uid()` is not null and (unless noted) that the caller is
`approved`. Member-facing checks raise friendly errors with a hint code.

Onboarding & profile
- `complete_onboarding(p_full_name text, p_phone text, p_rank text, p_station int, p_tour int, p_employee_id text) returns jsonb`
  Allowed when status in (`onboarding`,`pending`). Validates inputs, derives battalion/division,
  saves, then runs **roster matching** (§6.4). Returns `{status: 'approved'|'pending', matched: bool, message}`.
  On auto-approve: claims roster row, notifies admins (`member_auto_approved`). On pending:
  notifies admins (`member_pending`, body includes name, rank, station, phone, email). Audit.
- `acknowledge_telestaff() returns void` — sets `telestaff_ack_at`.
- `update_my_profile(p_phone text, p_station int, p_tour int, p_notify_scope text) returns void` — approved members; name/rank/employee_id are admin-only. Audit when station/tour change.
- `clear_must_change_password() returns void`.
- `regenerate_calendar_token() returns uuid`.
- `my_stats() returns jsonb` — `{posted, covered, given, outstanding, balance, trust_score, by_type: {'24-Hour': {covered, given, balance}, 'PM': {...}}}` where
  posted = my non-cancelled posts (original legs only, excluding return legs); covered = covered shifts where I'm coverer;
  given = covered shifts where I'm poster; outstanding = my open posts not started; balance = covered − given;
  trust_score = clamp(100 − 5·(my open, not-started posts created > 7 days ago) + 3·(shifts I covered whose starts_at is within the last 30 days and in the past), 0, 100).
- `my_ledger() returns table(partner_id uuid, partner_name text, partner_rank text, i_covered_24 int, i_covered_pm int, they_covered_24 int, they_covered_pm int, net_24 int, net_pm int, upcoming int, last_date date)` — net = I covered − they covered (positive ⇒ they owe me). `upcoming` counts **trades** that haven't started, not legs: a SwapMatch is one (0011, TF-8).
- `my_schedule(p_from date, p_to date) returns table(date date, base boolean, given_away boolean, picked_up boolean, working boolean, open_post_id uuid, given_shift_id uuid, picked_shift_id uuid, is_swap boolean, pm_given_away boolean)` — max 400 days. `given_away` is true for either type; `pm_given_away` when only the PM was given away; `working = (base and nothing given away) or pm_given_away or picked_up` (§4; the trailing column was added in 0011).
- `get_trade_contact(p_shift_id uuid) returns table(user_id uuid, full_name text, rank text, station int, phone text, email text)` — returns the *other* party(ies): for the poster, the coverer (if covered) and every requester with a pending/accepted request; for a requester/coverer, the poster. Nobody else.
- `member_card(p_user_id uuid) returns jsonb` — `{full_name, rank, station, battalion, trust_score, covered, given}` for any approved member (used to help posters choose between requests). No contact info.
- `member_cards(p_user_ids uuid[]) returns jsonb` (0011, NEXT-09) — a JSON array of the same objects plus `user_id`, in the order asked, each member once, approved members only; at most 50 distinct ids (`INVALID_INPUT` beyond that). The poster's request list loads every requester's card with one call (`getMemberCards`).

Shifts & trades
- `post_shift(p_date date, p_shift_type text, p_station int, p_return_dates date[], p_accept_limit text, p_notes text) returns uuid`
  Rules: telestaff acknowledged; `starts_at > now()`; `date <= today + 180`; type valid; station valid;
  accept_limit valid; notes ≤ 500; return_dates: at most 10, distinct, each a future date
  (its shift would start after now), ≠ `date`, ≤ today + 180. If the poster has a tour: the poster
  must be **working** on `date` by *base* schedule (it is one of their own tour days — picked-up
  days cannot be re-traded in v1) and must **not be working** (effective schedule) on any return
  date. No other open/covered post by the poster on that date (`ALREADY_POSTED`).
  Snapshots poster name/rank; location = p_station (default own station when null).
  Creates `new_shift` notifications for eligible members (see §6.5 fan-out). Audit.
- `cancel_post(p_shift_id uuid) returns void` — poster, status open. Pending requests → `cancelled` with `post_cancelled` notifications.
- `shift_eligibility(p_shift_id uuid, p_return_date date default null) returns jsonb` — `{eligible: bool, reasons: [{code, message}]}` using the same checks as `request_shift` (does not raise).
- `request_shift(p_shift_id uuid, p_return_date date, p_message text) returns uuid`
  Rules (each failing rule has a code): not own shift (`OWN_SHIFT`); shift open (`NOT_OPEN`) and not started (`STARTED`);
  same rank (`RANK_MISMATCH`); within accept_limit relative to shift's station vs requester's profile (`OUTSIDE_LIMIT`);
  requester not working that date (`YOU_WORK_THAT_DAY`) and not already covering a shift that date (`ALREADY_COVERING`);
  no pending request by requester on this shift (`ALREADY_REQUESTED`); if shift offers return dates: p_return_date required (`RETURN_DATE_REQUIRED`)
  and must be one of them (`RETURN_DATE_INVALID`), and the requester must be able to give that day (`RETURN_NOT_YOUR_DAY`; 0011 `private.can_give_return_date`: the return shift hasn't started, it is the requester's tour day — any day with no tour — and they have no open/covered post and aren't covering anyone that day);
  if shift offers none, p_return_date must be null. Message ≤ 300. Notifies poster (`request_received`).
- `withdraw_request(p_request_id uuid) returns void` — requester, pending only; notifies poster.
- `decline_request(p_request_id uuid) returns void` — poster, pending only; notifies requester.
- `confirm_request(p_request_id uuid) returns jsonb` — poster. Locks the shift row (`for update`), re-validates every request_shift rule against current data plus: the return date (if any) has not started; poster still off on the return date and has no open/covered post that date (`POSTER_WORKS_RETURN_DAY`); requester has no open/covered post on the return date. Sets shift covered (coverer, coverer_name, confirmed_at), request accepted, **all other pending requests on the shift declined** (notify each: "filled by another member"). If return_date: creates the return leg (§6.1). Notifies requester (`request_accepted`, mentions the return date for swaps). Audit. Returns `{shift_id, return_leg_id}`.
- `request_trade_cancel(p_shift_id uuid, p_reason text) returns void` — caller must be poster or coverer of a covered, not-started shift (either leg of a swap; resolved to the original leg). Sets cancel_requested_*; notifies the other party (`cancel_requested`).
- `respond_trade_cancel(p_shift_id uuid, p_agree boolean) returns void` — the *other* party. Agree ⇒ **undo the trade**: original leg back to `open` (coverer/confirmed cleared, cancel_* cleared) if not started else `cancelled`; return leg (if any) `cancelled`; the accepted request → `cancelled`; notify both (`trade_cancelled`). Decline ⇒ clear cancel_* and notify requester of the cancel (`cancel_declined`). Audit.
- `withdraw_trade_cancel(p_shift_id uuid) returns void` — the member who asked. Withdrawing, and declining through `respond_trade_cancel`, are allowed at any time, also after a leg has started, so a cancel request can never get stuck; only *agreeing* after a start is refused (`STARTED`, TF-5).

Messages & notifications
- `send_message(p_shift_id uuid, p_recipient_id uuid, p_body text) returns uuid` — sender and recipient must be {poster, X} where X has any request on the shift or is its coverer. Creates a `message` notification for the recipient (at most one unread `message` notification per (recipient, shift, sender): update the existing unread one instead of inserting).
- `mark_thread_read(p_shift_id uuid, p_other_id uuid) returns void`.
- `mark_notifications_read(p_ids uuid[]) returns void` — null ⇒ all mine.

Admin (caller must be `is_admin()`; every action audited)
- `admin_approve_member(p_user_id uuid, p_roster_id uuid default null)`, `admin_reject_member(p_user_id uuid, p_reason text)`,
  `admin_set_member_status(p_user_id uuid, p_status text, p_reason text)` (approved|suspended),
  `admin_set_role(p_user_id uuid, p_role text)` (cannot remove the last admin),
  `admin_update_member(p_user_id uuid, p_full_name text, p_rank text, p_station int, p_tour int, p_phone text, p_employee_id text)`,
  `admin_mark_must_change_password(p_user_id uuid)`.
- `admin_import_roster(p_rows jsonb, p_replace boolean) returns jsonb` — rows `[{first_name,last_name,employee_id?,rank?,station?,tour?,email?,phone?}]`; validates each (bad rank/station/tour ⇒ row error); `p_replace` deletes **unclaimed** rows first; upserts on (last_key, first_key, coalesce(employee_id,'')). Returns `{inserted, updated, skipped, errors:[{row, message}]}`.
- `admin_delete_roster_entry(p_id uuid)`.
- `admin_cancel_post(p_shift_id uuid, p_reason text)`, `admin_void_trade(p_shift_id uuid, p_reason text)` (same effect as agreed cancel, even after start ⇒ status cancelled; notifies both `trade_voided`).
- `admin_remove_member(p_user_id uuid, p_reason text) returns jsonb` (0011, CC-4) — removes an account at the member's request: refuses yourself, an account already removed and the last approved admin. Sets status `suspended` (status_reason "Account removed[: reason]"), `removed_at`, role `member`; clears phone and employee ID; turns alerts off; new calendar token; deletes push subscriptions and the member's notifications; releases the roster claim; takes their posts and requests off the board exactly like a suspension; keeps name snapshots on shifts; audit `member.removed`. Returns `{posts_cancelled, requests_closed, upcoming_trades}`. `admin_update_member` refuses removed accounts; `admin_set_member_status('approved')` / `admin_approve_member` reinstate one (clears `removed_at`). The server action `removeMember` then closes the login with the service key (sign-in email replaced, login banned).
- `admin_overview() returns jsonb` — counts: pending members, approved members, suspended members (not counting removed ones), `removed_members` (0011), open shifts, trades this month, roster size/unclaimed.

Public (anon)
- `app_keepalive() returns jsonb` — `{ok: true}` after a trivial read.
- `calendar_feed(p_token uuid) returns table(date date, kind text, title text, details text)` — for an approved member's token: working days from today−30 to today+365 (`kind` = 'work' | 'covering' | 'covered_for_me' | 'swap'), used by the ICS route. Unknown token ⇒ empty. Since 0011 a day whose PM was given away is one `work` event, "On duty 0800–1600 (Tour N)", naming who covers the PM; `covered_for_me` is only for 24-Hour give-aways.

### 6.4 Roster matching (inside `complete_onboarding`)

1. Normalize the applicant's name: first token of full name = first, last token = last
   (also try "Last, First" form). Keys via `name_key`.
2. Candidates = unclaimed roster rows with `last_key` equal and (`first_key` equal, or roster
   first is a single initial equal to the applicant's first initial).
3. Exactly one candidate required. For that row, compare every attribute the roster row has:
   employee_id (case-insensitive, trimmed), rank, station, tour, email (case-insensitive).
   Any mismatch ⇒ no auto-approve. Count matches.
4. Auto-approve iff **≥ 2 attributes match**, or employee_id matches. Otherwise `pending`,
   with `status_reason` describing the closest roster candidate for the admin ("Roster: John
   Smith, Station 19 — tour differs").
5. A roster row can be claimed once.

### 6.5 New-shift fan-out & push delivery

`post_shift` inserts a `new_shift` notification for each approved member where: not the poster;
same rank; `notify_scope <> 'off'` and the shift's station is within the member's scope
(station/battalion/division/all relative to the member's own station); the member satisfies the
shift's accept_limit; and (member has no tour, or member is not working that date). Since 0011:
"working" follows §4 (a PM give-away day counts), and for a SwapMatch the member must be able
to give at least one of the offered return dates (`private.can_give_return_date`, TF-3).

Push: an `after insert ... for each statement` trigger on `notifications` calls
`net.http_post(private.app_config.push_webhook_url, headers {x-webhook-secret})` **only if**
the `pg_net` extension and both config keys exist (otherwise it does nothing — PGlite tests
have no pg_net). `POST /api/push/flush` (secret header **or** any signed-in user) claims up to
200 notifications with `pushed_at is null and created_at > now() - interval '2 days'`
(`update ... set pushed_at = now() ... returning`), sends each to the user's subscriptions via
`web-push`, deletes subscriptions that return 404/410. The client also calls flush
(fire-and-forget) after any mutating RPC, so pushes go out even if the webhook isn't set up.

### 6.6 Error hint codes

`NOT_SIGNED_IN, NOT_APPROVED, NOT_ADMIN, ACK_REQUIRED, INVALID_INPUT, NOT_FOUND, OWN_SHIFT, NOT_OPEN,
STARTED, TOO_FAR_AHEAD, RANK_MISMATCH, OUTSIDE_LIMIT, YOU_WORK_THAT_DAY, NOT_YOUR_SHIFT_DAY,
ALREADY_POSTED, ALREADY_COVERING, ALREADY_REQUESTED, RETURN_DATE_REQUIRED, RETURN_DATE_INVALID,
RETURN_NOT_YOUR_DAY, POSTER_WORKS_RETURN_DAY, NOT_PARTICIPANT, NO_CANCEL_PENDING, LAST_ADMIN`.

### 6.7 Realtime

Publication `supabase_realtime` includes `shifts, shift_requests, notifications, messages`
(migration guarded: only if the publication exists). Clients subscribe with unique channel
names per mount and always `removeChannel` on unmount; realtime events trigger a debounced
refetch, never trusted as data.

## 7. Web app

### 7.1 Routes

```
/                      → redirect /calendar
/login, /signup        (auth) — public
/onboarding            (onboard) — signed in, status onboarding|pending (edit)
/pending               (onboard) — pending|rejected|suspended explanation + contact admin
/welcome               (onboard) — TeleStaff acknowledgment, install-app + enable-alerts steps
/change-password       (onboard) — forced when must_change_password
/calendar              (app) home
/board                 (app) ?shift=<id> opens a card
/post                  (app) ?date=YYYY-MM-DD prefill
/trades                (app) tabs: Pending · Confirmed · History · Balances
/trades/[id]           (app) shift/trade detail: parties, requests, actions, chat, "copy for paperwork"
/alerts                (app) notifications
/profile               (app) stats, trust score, edit, alerts settings, calendar subscribe, install, sign out
/admin                 (app, admin) Approvals (default) · /admin/members · /admin/roster · /admin/trades · /admin/activity
/privacy               public: disclaimer + privacy notice
/offline               offline fallback
/api/keepalive         GET, public
/api/push/flush        POST
/api/calendar/[token]  GET text/calendar (ICS)
```
Legacy redirects (installed PWAs may open old URLs): `/dashboard→/calendar`,
`/shift-board→/board`, `/post-shift→/post`, `/notifications→/alerts`, `/schedule-setup→/profile`,
and the pre-v1 email flows `/forgot-password`, `/reset-password`, `/verify-email`,
`/auth/callback` → `/login`. They live only in `next.config.ts` `redirects()` (307; Next runs
them before the proxy), tested by `tests/unit/proxy.test.ts`.

Gates (server-side, in layouts — the proxy only refreshes the session and bounces signed-out
users): signed out → `/login?next=…`; `onboarding` → `/onboarding`; `pending|rejected|suspended`
→ `/pending`; `must_change_password` → `/change-password`; no `telestaff_ack_at` → `/welcome`;
`/admin/**` requires role admin. A DB/network error in a gate renders an error state — it must
**never** be treated as "no profile".

### 7.2 UX rules

- Mobile-first, dark theme, existing tokens (Bebas Neue display, DM Sans body, SFFD red
  `#D32F2F`). Fix contrast: body text ≥ 4.5:1 (raise `--text-dim` to ≥ `#8A8AA3` on `#0a0a0f`).
- Tap targets ≥ 44 px, visible focus rings, labels bound to inputs, dialogs with
  `role="dialog"`, focus trap, Esc to close; toasts in an `aria-live` region; respect
  `prefers-reduced-motion`; iOS safe areas (`env(safe-area-inset-*)`); no `maximum-scale`.
- Every data view has loading, empty and error states. Errors show the RPC's friendly message.
- **Calendar colors** (legend always visible): Red = I'm working (my tour day, not given away);
  Orange = my open post; Blue = open shifts I could request that day (count badge);
  Gray = I'm covering someone; Purple = SwapMatch leg (either direction); a given-away tour day
  shows red outline + "Covered by <name>" (a day whose PM was given away keeps the red bar:
  "on duty 0800–1600, PM covered by <name>"). Tapping a day opens a bottom sheet with actions
  (Post this shift / See N available / View trade). The blue count uses the Board's
  "Only shifts I can take" query and rules in **every location** (`listBoardShifts` with
  `eligibleFor`, then the SwapMatch return-date rule and the day rule), and "See N available"
  opens `/board?date=<day>&scope=all`, so the Board shows exactly the shifts that were counted.
- **Board**: default filters = My Battalion + my rank (`?scope=all` opens it on every location;
  `?date=` shows one day); filter chips Division ▸ Battalion ▸ Station
  (cascade) and "Only shifts I can take" (default on: my rank, within each post's limit, not
  on days I'm on duty, cover or have a post — from `my_schedule` — and for a SwapMatch at least
  one offered return date I could give). Cards show date, type, station, poster,
  SwapMatch return dates, limit, notes, status, and my request status. Request opens a sheet
  (pick return date for SwapMatch, optional message) and shows eligibility reasons when not
  eligible. "Load more" pagination ordered by (date, created_at, id).
- **Post**: pick from my upcoming tour days (calendar strip); no-tour members pick any future
  date. Type 24-Hour/PM, location (defaults to my station, cascade), up to 10 return dates
  (from my off days), limit Anyone/My Division/My Battalion/My Station, notes.
- **Trades**: Pending (my outgoing requests; requests on my posts with Confirm/Decline; cancel
  requests awaiting my answer), Confirmed (upcoming, both legs), History, Balances (per
  partner, per type, "Mike owes you 1 × 24-Hour"). Trade detail shows partner contact
  (tap-to-call/text), chat, "Ask to cancel", and "Copy trade summary" (plain text for the
  paperwork: names, ranks, stations, date, hours, return date).
- **Profile**: Posted, Covered, Given, Outstanding, Balance = Covered − Given, reciprocity
  bar, trust score (positive tone). Edit phone/station/tour, alert scope, push toggle,
  "Add to my calendar" (webcal link to `/api/calendar/<token>`), change password, sign out
  (clears SW caches, local scope), links to privacy/disclaimer.
- **Offline**: cached snapshot of the last calendar/board/trades data in `localStorage` per
  user; when offline or the fetch fails, show it with a yellow "Offline snapshot · updated
  HH:MM" ribbon.
- **Copy tone**: plain English for firefighters; no jargon like "RPC", "PGRST", "NOSIGNAL".

### 7.3 Code layout

```
src/lib/env.ts                 validated env (publishable/anon + secret/service-role key aliases)
src/lib/supabase/{client,server,admin,session}.ts
src/lib/sffd/{dates,tours,stations,ranks,shift-types}.ts
src/lib/roster/{normalize,csv}.ts
src/lib/types/database.ts      row + RPC types (hand-written, mirror §6)
src/lib/api/*.ts               typed wrappers: one function per RPC/read; return {data} | throw AppError
src/lib/errors.ts              AppError(code, message) from Supabase/PostgREST errors
src/lib/schedule/effective.ts  client-side effective schedule from tour + trades (mirrors §4)
src/lib/push/{client,server}.ts
src/lib/auth/sign-out.ts       signOutOnThisDevice(): the one browser sign-out (§9)
src/lib/pwa/update-check.ts    new-deploy check on resume (X-App-Version on /sw.js)
src/lib/validation.ts          shared form rules (phone, password, name, employee ID)
src/lib/format.ts              shared display helpers (relativeTime, plural, tel/sms links, tour and accept-limit labels)
src/lib/ics.ts                 RFC 5545 generator (all-day events, CRLF, folding, escaping)
src/lib/offline-cache.ts
src/components/ui/*            primitives (Button, Card, Sheet, Dialog, ConfirmDialog, Field, Input, Chip, Badge, Tabs, Toast, EmptyState, ErrorState, Skeleton, Spinner; cn())
src/components/forms/*         PasswordInput, FormAlert
src/components/pickers/*       StationPicker, TourPicker
src/components/*               shared app components (Navigation, AppShell, AppHeader, AlertsNudge, PushToggle, OfflineRibbon, PWARegister, InstallPrompt, providers/ProfileProvider)
src/app/**                     routes per §7.1; route-specific components colocated in `_components/`
supabase/migrations/*.sql      schema (§6)
tests/db/*.test.ts             PGlite tests of every RPC and RLS rule
tests/unit/*.test.ts           dates, tours (vs fixture), roster normalize/csv, ics, effective schedule, errors
scripts/db/migrate.mjs         apply migrations to POSTGRES_URL_NON_POOLING / DATABASE_URL
```

### 7.4 Environment variables

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | set by Vercel↔Supabase integration |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | either accepted |
| `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` | server only | signup, admin password reset, push flush |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | public / server / server | web push |
| `PUSH_WEBHOOK_SECRET` | server | shared with `private.app_config` |
| `POSTGRES_URL_NON_POOLING` (or `DATABASE_URL`) | local scripts only | migrations |

Missing Supabase vars must fail loudly at request time with a clear message, and must not
take down `/offline`, `/privacy` or `/api/keepalive` (keepalive reports `{ok:false, reason}`).

## 8. Quality bar

- `npm run check` (lint + typecheck + all tests) and `npm run build` pass.
- Every RPC rule and every RLS row in §6.2 has a database test (allowed and denied cases).
- Tour math matches the fixture for all 31 tours across 2019–2035.
- Security headers: CSP (self + Supabase URL for connect/wss), `frame-ancestors 'none'`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Content-Type-Options`,
  and `X-Robots-Tag: noindex` (private tool).
- Service worker never caches authenticated HTML or API/Supabase responses; caches only
  static assets + `/offline`; versioned cache names; old caches deleted on activate.

## 9. Implementation notes (adopted during the foundation build — these override §6/§7 where they differ)

Database
- **Roster note privacy:** `profiles.status_reason` stays **null while pending** (members can read their own row; the roster is admin-only). The roster-match note lives in `audit_log` (action `member.pending`, `details.roster_note`, `details.roster_id`). `listPendingApprovals()` joins it for the admin queue. `status_reason` is used only for admin reject/suspend reasons.
- Roster auto-approval is attempted only on an account's **first 3** onboarding submissions (then it stays pending with `auto_approve_blocked`). A **blank employee ID counts as a mismatch** when the roster row has one — the onboarding form should encourage entering it.
- `request_shift` also requires the TeleStaff acknowledgment (`ACK_REQUIRED`). `YOU_WORK_THAT_DAY` also applies when the requester has an **open post** that day. A shift whose poster is no longer approved is `NOT_OPEN`.
- `shift_eligibility` returns `{eligible, reasons, valid_return_dates}`; with a null return date on a SwapMatch it evaluates every offered date.
- Undoing a trade (agreed cancel, admin void) is refused with `ALREADY_COVERING` if it would double-book someone. Agreeing to cancel after either leg started ⇒ `STARTED` (admins can still void).
- Suspending a member cancels their not-started open posts and closes pending requests on/by them. Removing one (`admin_remove_member`, 0011) does the same through the same helper.
- Accounts can only be created by the app (0011, SEC-6): a deferred constraint trigger on `auth.users` (`private.block_unconfirmed_signup`) refuses, at commit, any new account whose email is still unconfirmed. The app's sign-up (`auth.admin.createUser` with `email_confirm: true`) and the smoke scripts are unaffected; Supabase's public sign-up endpoint, magic-link sign-ups and the dashboard's "Invite user" are refused. It relies on "Confirm email" staying on; "Allow new users to sign up" should still be off (docs/DEPLOY.md).
- `push_subscriptions`: `user_id` defaults to `auth.uid()`; inserting an existing endpoint replaces the old row (trigger) — use a **plain insert**. Endpoints must be real push services (CHECK constraint; SQLSTATE `23514` ⇒ show "alerts aren't supported in this browser").
- Extra functions: `public.signup_rate_check(p_ip_hash, p_max, p_window_minutes)` (service role only) for the sign-up server action; `public.claim_push_batch(p_limit)` (service role only).
- New-shift fan-out skips anyone with an open post or picked-up shift that day.

Libraries & API
- `src/lib/api/*` functions take the Supabase client first, **return data directly and throw `AppError`** (`src/lib/errors.ts`); paged reads return `{items, nextCursor}`. Notifying RPC wrappers automatically fire-and-forget `POST /api/push/flush` (browser only; debounced).
- `diffDays(a, b)` = b − a. `computeMonthDays({userId, tour, year, month, myShifts, boardCounts, today?})` returns 6×7 `weeks` with a `tone` per day (precedence swap > covering > openPost > working > givenAway > available > off).
- The proxy (`src/proxy.ts` + `src/lib/supabase/session.ts`) refreshes the session, sends signed-out `/api/*` requests a 401 JSON, honours a safe `?next=`, and never signs anyone out because of a Supabase outage (layout gates show an error state instead). Legacy redirects are in `next.config.ts` only (§7.1). `resolveUserId`/`sessionCheckError()` treat an Auth 5xx or no connection as `NETWORK`, never as `NOT_SIGNED_IN`.
- Shared helpers — use these instead of local copies: `src/lib/validation.ts` (phone, password, name and employee-ID rules as plain validators and zod schemas; the phone rule matches `private.valid_phone` plus 7+ digits), `src/lib/format.ts` (`relativeTime`, `plural`, `dialablePhone`/`telHref`/`smsHref`, `tourLabel`, `acceptLimitLabel`), `src/components/forms/{PasswordInput,FormAlert}.tsx`, and `cn()` (tailwind-merge: later classes win).
- Server-only modules (`src/lib/supabase/admin.ts`, `getServerEnv()`) throw if imported in the browser (runtime check; the `server-only` package is not installed).

UI shell
- `(app)` layout renders `<ProfileProvider profile={profile}><AppShell>{children}</AppShell></ProfileProvider>`; every page renders `<AppHeader title=… />` (the page's only `h1`). Use `useProfile()` for the current member.
- Text colours: `--text-secondary #A3A3B8`, `--text-dim #8A8AA3`; use `--sffd-red-text #FF4D4D` for red **text** (keep `#D32F2F` for fills). Stagger animation classes are `stagger-1..4`.
- Sign-out sequence: every sign-out button calls `signOutOnThisDevice()` (`src/lib/auth/sign-out.ts`): best-effort and time-boxed push unsubscribe, clear offline snapshots and this device's prompt flags, close shown notifications, `clearAppCaches()` (keeps the service worker's `shiftswap-static-*` cache so `/offline` keeps working), `signOut({ scope: 'local' })` (a failure still counts as signed out; the session cookies are removed by hand), then always a full page load of `/login`. The login page also clears offline snapshots (SEC-7).
- The `(app)` gates also run in the browser: `ProfileProvider` re-reads the profile on focus, visibility, reconnect and navigation (at most once a minute) and reloads the page when the member was suspended or removed, changed role or must change their password. `PWARegister` checks for a new deploy on resume (`X-App-Version` header on `/sw.js`, `src/lib/pwa/update-check.ts`).
- After marking alerts read call `announceNotificationsChanged()` (from `@/hooks/useUnreadCount`).
- Push payload sent by the server: JSON `{ title, body, url, tag? }` (`url` must be a same-origin path; chat tag `message:<shiftId>:<senderId>`).

### 9.1 Review-fix notes (migration 0011 and the shared helpers, 2026-09-23)

- **Sign-up lockdown:** a deferred (commit-time) constraint trigger on `auth.users` refuses any account still unconfirmed at commit, so only the app's server-side `admin.createUser(email_confirm: true)` can create members (Supabase inserts then confirms inside one transaction). Keep "Confirm email" **on** in Supabase Auth settings.
- **Account removal:** `admin_remove_member` scrubs contact details, suspends, sets `profiles.removed_at`; the admin server action also bans the auth user and renames its email to `removed+<id>@shiftswap.invalid` so the address can re-register.
- `member_cards(uuid[])` batches requester cards; `my_ledger.upcoming` counts a SwapMatch pair once; SwapMatch new-shift alerts go only to members who can give an offered return date (`private.can_give_return_date`, mirrored client-side).
- **Shared client helpers:** sign-out is `signOutOnThisDevice()` in `src/lib/auth/sign-out.ts` (always ends with a full reload to /login; static/offline caches are kept); validation rules in `src/lib/validation.ts`; formatting in `src/lib/format.ts`; `PasswordInput`/`FormAlert` in `src/components/forms/`; `AlertsNudge` for enabling push inside the installed iPhone app.
- **Board URL params:** `?date=YYYY-MM-DD`, `?scope=all` (all locations, my rank, "Only shifts I can take" on) and `?shift=<id>`. The calendar's "See N available" uses the same query as the board.
- **Redirects:** legacy routes (incl. /forgot-password, /reset-password, /verify-email, /auth/callback) redirect in `next.config.ts` only.
- A cancel request on a trade that has started can still be withdrawn or dismissed (agreeing is disabled; only an admin can void).
