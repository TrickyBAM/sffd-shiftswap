# Deploying and Running ShiftSwap

How ShiftSwap is hosted, how to ship a new version, how to turn on push
alerts, how to roll back, and how to know when something is wrong.

- **App:** Vercel project `sffd-shiftswap`. Production is
  <https://sffd-shiftswap.vercel.app>.
- **Database:** Supabase (Postgres, sign-in, realtime), added through the Vercel
  Marketplace. Resource `sffd-shiftswap-db`, region `sfo1`, free plan. Open it
  from Vercel ▸ sffd-shiftswap ▸ **Storage**.
- **Code:** GitHub `TrickyBAM/sffd-shiftswap`. `main` is production.

There is **one database**. Unless you set up separate database branches, preview
deployments and local development use the same live data as production. Test
with throwaway accounts and clean up afterwards (the smoke test does this for
you).

---

## 1. Environment variables

Set them in Vercel ▸ sffd-shiftswap ▸ **Settings ▸ Environment Variables**, or
with the CLI (`vercel env add NAME production`). Changes only apply to **new**
deployments, so redeploy after changing one. `NEXT_PUBLIC_*` values are built
into the app at build time.

| Name | Environments | How to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | Set automatically by the Supabase integration |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | all | Set automatically. Either name works. |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | all (server only) | Set automatically. Never put it in a `NEXT_PUBLIC_` variable. |
| `POSTGRES_URL_NON_POOLING` | local scripts | Set automatically. Used by `npm run db:migrate` and `scripts/db/*`. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | all | `npx web-push generate-vapid-keys`: the public key |
| `VAPID_PRIVATE_KEY` | all (server only) | The private key from the same command |
| `VAPID_SUBJECT` | all (server only) | A contact for push services: `mailto:you@example.com` or an `https://` URL |
| `PUSH_WEBHOOK_SECRET` | all (server only) | A long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |

Notes:

- **Generate the VAPID keys once.** Changing them later silently breaks every
  member's existing alert subscription (they'd have to turn alerts off and on).
- Without the VAPID values, push alerts are skipped (`/api/push/flush` answers
  `{"skipped":"push not configured"}`). In-app alerts still work.
- Without the Supabase values, pages show a clear "not configured" message and
  `/api/keepalive` answers 503 with the reason. Nothing crashes.
- For local work, `vercel env pull .env.local` downloads everything. `.env*`
  files are gitignored. **Never commit secrets.**
- CI builds with placeholder values (see `.github/workflows/ci.yml`). It never
  needs real secrets.

---

## 2. Shipping a new version (preview, then production)

1. **Check the code.** Run `npm run check` (lint, typecheck, all tests) and
   `npm run build` locally, or wait for the **CI** workflow on GitHub to go
   green.
2. **Apply database changes first**, if the version adds migrations:

   ```sh
   vercel env pull .env.local        # if you don't have it yet
   npm run db:migrate -- --dry-run   # shows which files will run
   npm run db:migrate                # applies them, one transaction per file
   ```

   The live app keeps running against the new schema until the new code is
   deployed, so migrations must be **additive** (new tables, columns or
   functions; don't drop or rename something the running version uses). Remove
   old things in a later migration, after the new code is live.
3. **Deploy a preview:** `vercel deploy` (or push the branch, when the Vercel ↔
   GitHub connection is on). Vercel prints a preview URL. Preview URLs are behind
   Vercel Authentication, so sign in to Vercel to open them.
4. **Check the preview** on a phone: sign in, open Calendar, Board and Trades,
   and try a post or request with a test account. Open `<preview-url>/api/keepalive`.
   It should say `"ok": true`.
5. **Go to production**, in one of these ways:
   - merge the branch into `main` (production deploys automatically when the Git
     connection is on), or
   - promote the preview you checked: `vercel promote <preview-url>`, or
     **Promote** on it in the Vercel dashboard, or
   - `vercel deploy --prod`.
6. **Check production:** <https://sffd-shiftswap.vercel.app/api/keepalive>
   says `"ok": true`, you can sign in, and a test alert arrives on your phone.

Before a big release, also run the live smoke test:
`node scripts/smoke/live-smoke.mjs`. It creates `e2e-…@example.com` members,
runs the trade flows against the real database and deletes everything it made.

### First launch checklist (v1)

- [ ] All environment variables in section 1 are set for Production and Preview.
- [ ] `npm run db:migrate -- --status` shows every migration applied.
- [ ] Production deployed from `main`, and `/api/keepalive` says `"ok": true`.
- [ ] Brian signed up in the app, then `node scripts/db/make-admin.mjs <his email>`.
- [ ] Roster uploaded (Admin ▸ Roster, see `docs/ADMIN-GUIDE.md`).
- [ ] Push webhook enabled (section 3), and a test alert arrived on an iPhone
      with the app installed.
- [ ] The **Keepalive** workflow run by hand (GitHub ▸ Actions ▸ Keepalive ▸ Run
      workflow) is green, and Vercel ▸ Settings ▸ Cron Jobs lists `/api/keepalive`.

---

## 3. Push alerts: enabling the database webhook

How alerts are delivered: whenever the database creates a notification, the app
(or the database webhook) calls `POST /api/push/flush`, which sends everything
not yet sent. The app already calls it after every action, so alerts work
without the webhook. The webhook makes delivery immediate and reliable, even
when the action came from somewhere else (for example an admin tool or a
database script).

1. **Set `PUSH_WEBHOOK_SECRET`** in Vercel (section 1) and redeploy. Put the same
   value in your `.env.local`.
2. **Enable the `pg_net` extension** (it lets the database make web requests).
   Either go to the Supabase dashboard ▸ **Database ▸ Extensions** and turn on
   **pg_net**, or run this in the SQL editor:

   ```sql
   create extension if not exists pg_net;
   ```

3. **Tell the database where to send the webhook** (run in the project folder):

   ```sh
   node scripts/db/set-app-config.mjs \
     push_webhook_url=https://sffd-shiftswap.vercel.app/api/push/flush \
     push_webhook_secret=@env:PUSH_WEBHOOK_SECRET
   ```

   `@env:PUSH_WEBHOOK_SECRET` reads the value from `.env.local`, so the secret
   never lands in your shell history. It must be exactly the same as
   `PUSH_WEBHOOK_SECRET` in Vercel. Check with
   `node scripts/db/set-app-config.mjs --list` (secret values are hidden).
4. **Test it:**

   ```sh
   curl -i -X POST https://sffd-shiftswap.vercel.app/api/push/flush                 # 401: no secret
   curl -i -X POST -H "x-webhook-secret: <the secret>" \
     https://sffd-shiftswap.vercel.app/api/push/flush                               # 200 {"claimed":…}
   ```

   A `{"skipped":"push not configured"}` answer means the VAPID variables are
   missing in that deployment.
5. **See what the database sent** (SQL editor): recent webhook calls and their
   HTTP status:

   ```sql
   select id, status_code, error_msg, created
   from net._http_response order by created desc limit 20;
   ```

The trigger does nothing unless `pg_net` is enabled **and** both settings
exist, so it is safe to set up in any order. To turn the webhook off:
`node scripts/db/set-app-config.mjs --unset push_webhook_url push_webhook_secret`.

**Changing the secret:** set the new value in Vercel, redeploy, then run step 3
again with the new value. Until both match, the webhook gets 401s, but alerts
still go out through the app's own calls.

---

## 4. Rolling back

### The app

- **Vercel dashboard:** sffd-shiftswap ▸ **Deployments** ▸ the last good
  production deployment ▸ **⋯ ▸ Instant Rollback**. It takes effect in seconds.
  (On the Hobby plan you can roll back to the previous production deployment.
  To go further back, **Promote** an older deployment.)
- **CLI:** `vercel rollback` (to the previous one) or
  `vercel rollback <deployment-url>`.
- After an Instant Rollback, Vercel **stops sending new deploys to production**
  until you undo the rollback or promote a deployment. Once the fix is ready,
  promote it (section 2, step 5).

### The database

Migrations only go forward; there are no automatic "down" migrations. To
undo a change, write a **new** migration that reverses it, test it
(`npm run test:db`), and apply it.

The free plan has **no automatic backups**. Before a risky migration, take one
yourself (needs PostgreSQL 17 client tools):

```sh
pg_dump "$POSTGRES_URL_NON_POOLING" --format=custom --schema=public --schema=private --file=shiftswap-YYYY-MM-DD.dump
```

Backups contain members' personal details. Keep them somewhere private and
**never** in the repository.

---

## 5. Keepalive and monitoring

**Health endpoint:** `GET /api/keepalive` runs a tiny database query and
answers:

- `200 {"ok": true, "db": "ok", "at": "…"}`: the app and database are fine.
- `503 {"ok": false, "reason": "…", "at": "…"}`: not configured, database
  unreachable or paused, or no answer within 8 seconds. The `reason` says which.

It is never cached and needs no sign-in.

**Two daily pings** keep the free database from being paused (Supabase pauses
free projects after about a week with no activity) and act as a health check:

| Who | When | Where to look |
|---|---|---|
| Vercel Cron (`vercel.json`) | 15:00 UTC daily (08:00 PDT / 07:00 PST) | Vercel ▸ Settings ▸ Cron Jobs, and Logs |
| GitHub Action (`.github/workflows/keepalive.yml`) | 03:17 UTC daily, and "Run workflow" by hand | GitHub ▸ Actions ▸ Keepalive |

The GitHub Action tries 4 times, 30 seconds apart. If it never gets a 200, the
run **fails and GitHub emails** the person who last changed the workflow's
schedule. To be sure the email reaches Brian, check GitHub ▸ Settings ▸
Notifications ▸ **Actions** is on (email, failed workflows). Two GitHub quirks:
scheduled workflows only run from `main`, and GitHub turns off schedules in a
public repository after 60 days without any commits. If that happens, re-enable
the workflow on the Actions tab.

**Logs:** Vercel ▸ sffd-shiftswap ▸ **Logs**. Useful prefixes: `[keepalive]`,
`[push/flush]`, `[push]`, `[calendar]`, `[app layout]`. These routes are written
so their logs never contain passwords, keys, calendar tokens or full push
addresses.

**Usage:** Supabase dashboard ▸ **Usage** shows database size, bandwidth and
active users against the free-plan limits.

**If the app is down:** follow "If ShiftSwap is down" in
`docs/ADMIN-GUIDE.md`. In short: check `/api/keepalive`, restore the database if
it was paused, roll back if a deploy broke it, and check
<https://www.vercel-status.com> and <https://status.supabase.com>.

---

## 6. Upgrading the Supabase plan

Stay on the free plan while testing. Upgrade to **Pro** before the whole
department relies on ShiftSwap, or when Usage shows you getting close to a
limit (the free database holds 500 MB). Pro projects are never paused, get daily
backups, and have much higher limits. It costs about $25 a month, billed through
Vercel. Check current pricing on the Supabase site.

1. Vercel ▸ sffd-shiftswap ▸ **Storage** ▸ `sffd-shiftswap-db` ▸ open its
   settings (or **Open in Supabase**) and change the plan to **Pro**. Billing
   goes through Brian's Vercel account.
2. Nothing in the app changes: same URL, same keys, same environment variables.
   No redeploy is needed.
3. Changing the **compute size** (separate from the plan) restarts the database
   for a minute or two. Do it at a quiet time.
4. Keep the keepalive pings. They cost nothing and double as a daily health check.
