#!/usr/bin/env node
// Visual tour of every screen on a phone-sized browser, against a live deployment.
//
// Seeds a realistic scenario with throwaway e2e members (see _harness.mjs), logs in
// through the real login form as each member, screenshots each screen into
// .tmp-test/shots/, records browser console errors / failed requests (e.g. CSP
// violations), then deletes every e2e row it created.
//
//   node scripts/smoke/ui-tour.mjs                         # https://sffd-shiftswap.vercel.app
//   node scripts/smoke/ui-tour.mjs --base http://localhost:3100
//   node scripts/smoke/ui-tour.mjs --keep                  # leave the data for manual checks
import fs from 'node:fs'
import path from 'node:path'
import { chromium, devices } from 'playwright'
import { db, q, rpc, makeMember, cleanup, pickDates, promoteToAdmin } from './_harness.mjs'

const argBase = process.argv.indexOf('--base')
const BASE = argBase > -1 ? process.argv[argBase + 1] : 'https://sffd-shiftswap.vercel.app'
const KEEP = process.argv.includes('--keep')
const OUT = path.resolve('.tmp-test/shots')
fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f))

const problems = []
let shotNo = 0

const longDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function newPage(browser, who) {
  const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`[${who}] console error on ${page.url()}: ${msg.text().slice(0, 300)}`)
  })
  page.on('pageerror', (err) => problems.push(`[${who}] page error on ${page.url()}: ${err.message.slice(0, 300)}`))
  page.on('requestfailed', (req) => {
    const url = req.url()
    if (/_rsc=|\/_next\/.*prefetch/.test(url)) return // aborted prefetches are normal
    problems.push(`[${who}] request failed ${req.failure()?.errorText} ${url.slice(0, 160)}`)
  })
  return { context, page }
}

async function settle(page, ms = 1800) {
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForTimeout(ms)
}

async function shot(page, name) {
  const file = path.join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`  shot ${path.basename(file)}  (${page.url().replace(BASE, '')})`)
}

async function visit(page, url, name, ms) {
  try {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
    await settle(page, ms)
    await shot(page, name)
  } catch (err) {
    problems.push(`visit ${url} failed: ${err.message.split('\n')[0]}`)
  }
}

async function login(page, member, who) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill(member.email)
  await page.getByLabel('Password', { exact: true }).fill(member.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {
    problems.push(`[${who}] login did not leave /login`)
  })
  await settle(page)
}

async function tryStep(label, fn) {
  try {
    await fn()
  } catch (err) {
    problems.push(`${label}: ${err.message.split('\n')[0]}`)
  }
}

async function main() {
  await db.connect()
  await cleanup()
  const TA = 1, TB = 5
  const { D, R, D2 } = await pickDates(TA, TB)
  console.log(`Base ${BASE}; Alex (Tour ${TA}) posts ${D} (SwapMatch back ${R}) and ${D2}`)

  // --- Seed -----------------------------------------------------------------
  const boss = await makeMember('Chief Admin')
  await promoteToAdmin(boss)
  const alex = await makeMember('Alex')
  const ben = await makeMember('Ben')
  const pat = await makeMember('Pat')
  const nia = await makeMember('Nia')
  const wes = await makeMember('Wes')
  const [aFirst, ...aRest] = alex.fullName.split(' ')
  await rpc(boss.sb, 'admin_import_roster', {
    p_rows: [
      { first_name: aFirst, last_name: aRest.join(' '), rank: 'Firefighter', station: 2, tour: TA },
      { first_name: 'Maria', last_name: 'Santos', rank: 'Lieutenant', station: 19, tour: 12, employee_id: '51234' },
    ],
    p_replace: false,
  })
  await rpc(alex.sb, 'complete_onboarding', { p_full_name: alex.fullName, p_phone: '415-555-0101', p_rank: 'Firefighter', p_station: 2, p_tour: TA })
  await rpc(ben.sb, 'complete_onboarding', { p_full_name: ben.fullName, p_phone: '415-555-0102', p_rank: 'Firefighter', p_station: 13, p_tour: TB })
  await rpc(boss.sb, 'admin_approve_member', { p_user_id: ben.id })
  await rpc(pat.sb, 'complete_onboarding', { p_full_name: pat.fullName, p_phone: '415-555-0104', p_rank: 'Firefighter', p_station: 28, p_tour: 20, p_employee_id: '48213' })
  await rpc(wes.sb, 'complete_onboarding', { p_full_name: wes.fullName, p_phone: '415-555-0105', p_rank: 'Firefighter', p_station: 5, p_tour: 12 })
  await rpc(boss.sb, 'admin_approve_member', { p_user_id: wes.id })
  for (const m of [alex, ben]) await rpc(m.sb, 'acknowledge_telestaff')

  const swapId = await rpc(alex.sb, 'post_shift', {
    p_date: D, p_shift_type: '24-Hour', p_return_dates: [R], p_accept_limit: 'battalion', p_notes: 'Need this one for a family thing — thanks!',
  })
  const openId = await rpc(alex.sb, 'post_shift', { p_date: D2, p_shift_type: 'PM' })
  await rpc(ben.sb, 'request_shift', { p_shift_id: swapId, p_return_date: R, p_message: 'I can take it — I work 9/29 if you can do mine.' })
  await rpc(ben.sb, 'send_message', { p_shift_id: swapId, p_recipient_id: alex.id, p_body: 'Relief at 0730 work for you?' })

  const browser = await chromium.launch()
  try {
    // --- Public + onboarding screens ------------------------------------------
    {
      const { context, page } = await newPage(browser, 'public')
      await visit(page, '/login', 'login')
      await visit(page, '/signup', 'signup')
      await visit(page, '/privacy', 'privacy')
      await context.close()
    }
    {
      const { context, page } = await newPage(browser, 'nia')
      await login(page, nia, 'nia')
      await shot(page, 'onboarding')
      await context.close()
    }
    {
      const { context, page } = await newPage(browser, 'pat')
      await login(page, pat, 'pat')
      await shot(page, 'pending')
      await context.close()
    }
    {
      const { context, page } = await newPage(browser, 'wes')
      await login(page, wes, 'wes')
      await shot(page, 'welcome')
      await context.close()
    }

    // --- Ben (requester) -------------------------------------------------------
    {
      const { context, page } = await newPage(browser, 'ben')
      await login(page, ben, 'ben')
      await shot(page, 'ben-landing')
      await visit(page, '/board', 'ben-board', 2500)
      await visit(page, `/board?shift=${openId}`, 'ben-request-sheet', 2500)
      await visit(page, '/trades', 'ben-trades')
      await visit(page, `/trades/${swapId}`, 'ben-trade-detail-requested', 2500)
      await context.close()
    }

    // --- Alex (poster) ---------------------------------------------------------
    {
      const { context, page } = await newPage(browser, 'alex')
      await login(page, alex, 'alex')
      await shot(page, 'alex-calendar')
      await tryStep('open calendar day sheet', async () => {
        await page.getByRole('button', { name: new RegExp('^' + escapeRe(longDate(D))) }).first().click()
        await page.waitForTimeout(800)
        await shot(page, 'alex-day-sheet')
        await page.keyboard.press('Escape')
      })
      await visit(page, '/trades', 'alex-trades-pending')
      await visit(page, `/trades/${swapId}`, 'alex-trade-requests', 2500)
      await tryStep('confirm Ben from the UI', async () => {
        await page.getByRole('button', { name: /^Confirm/ }).first().click()
        await page.waitForTimeout(600)
        await shot(page, 'alex-confirm-dialog')
        await page.getByRole('button', { name: 'Confirm trade' }).click()
        await page.waitForTimeout(3000)
        await shot(page, 'alex-trade-confirmed')
      })
      await visit(page, '/trades?tab=confirmed', 'alex-trades-confirmed')
      await visit(page, '/trades?tab=balances', 'alex-trades-balances')
      await visit(page, '/post', 'alex-post', 2500)
      await visit(page, '/alerts', 'alex-alerts')
      await visit(page, '/profile', 'alex-profile', 2500)
      await context.close()
    }

    // --- Ben after confirmation -----------------------------------------------
    {
      const { context, page } = await newPage(browser, 'ben2')
      await login(page, ben, 'ben2')
      await visit(page, '/calendar', 'ben-calendar-after', 2500)
      await visit(page, `/trades/${swapId}`, 'ben-trade-detail-confirmed', 2500)
      await visit(page, '/alerts', 'ben-alerts')
      await context.close()
    }

    // --- Admin -------------------------------------------------------------------
    {
      const { context, page } = await newPage(browser, 'admin')
      await login(page, boss, 'admin')
      await visit(page, '/admin', 'admin-approvals', 2500)
      await visit(page, '/admin/members', 'admin-members', 2500)
      await visit(page, '/admin/roster', 'admin-roster', 2500)
      await visit(page, '/admin/trades', 'admin-trades', 2500)
      await visit(page, '/admin/activity', 'admin-activity', 2500)
      await context.close()
    }
  } finally {
    await browser.close()
  }

  const [{ n }] = await q(`select count(*)::int as n from public.shifts where return_leg_of = $1`, [swapId])
  console.log(`\nReturn leg created by the UI confirm: ${n === 1 ? 'yes' : 'NO'}`)
  console.log(`\n${problems.length} problem(s) recorded:`)
  for (const p of problems) console.log(' - ' + p)
}

try {
  await main()
} finally {
  if (!KEEP) console.log(`Cleaned up ${await cleanup().catch(() => 0)} e2e member(s).`)
  await db.end()
}
