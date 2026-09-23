#!/usr/bin/env node
// Rebuilds tests/fixtures/tour-truth.json from the public per-tour Google
// Calendars that sffirecu.org links from https://sffirecu.org/about-us/3461-2/
// (SF Fire Credit Union "Tour calendars" page).
//
// Usage:
//   node tests/fixtures/build-tour-truth.mjs            # download the feeds
//   node tests/fixtures/build-tour-truth.mjs --from DIR # use DIR/tour-<n>.ics + DIR/tour-watch.ics
//
// The script is dependency-free on purpose (Node >= 20: global fetch). It
// understands the subset of RFC 5545 these feeds use: all-day DTSTART,
// RRULE FREQ=DAILY with INTERVAL/UNTIL/COUNT, EXDATE, RECURRENCE-ID overrides
// and STATUS:CANCELLED.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'tour-truth.json')
const PAGE = 'https://sffirecu.org/about-us/3461-2/'
const RANGE = { from: '2019-01-01', to: '2035-12-31' }
const EPOCH = '2019-01-01'

// Calendar IDs as linked from the sffirecu.org page (fetched 2026-09-23).
const WATCH_CALENDAR = 'sffdwatch@gmail.com'
const TOUR_CALENDARS = {
  1: 'uuud3s1f5p87ipfspo39a5smh0@group.calendar.google.com',
  2: 'pbq235i7gsbvsdr5ufhq7kdiv4@group.calendar.google.com',
  3: '3nkfa4v0l1l024797bj5ecib9o@group.calendar.google.com',
  4: 'u3gtcp3fs2vv630uedvvjajhqo@group.calendar.google.com',
  5: 'b7f6gditq0ifde915e7vfdn1g4@group.calendar.google.com',
  6: '85hk8gnb1rjcmddrd0s3ur392k@group.calendar.google.com',
  7: 'q8novfp0seng6v0vjvcl0pmkdo@group.calendar.google.com',
  8: '4kp1gsoogirv8td5sg2uc2nnr8@group.calendar.google.com',
  9: 'eo2gooa176pub30f2a6uclc8sc@group.calendar.google.com',
  10: 'bvect6u32i2okt0h5mg0iuaaqo@group.calendar.google.com',
  11: 'h80n4vv6dla8jqmmil9llr1o3g@group.calendar.google.com',
  12: 'mcmf2nrp5dvka28e5bhlnd8n14@group.calendar.google.com',
  13: 'sogqcj6h51gj3r7ind984uqg8k@group.calendar.google.com',
  14: 'jj4bd7mnehuj3mrfi926npg3nc@group.calendar.google.com',
  15: 'o8nlqmmhtfr900noabvn2votr8@group.calendar.google.com',
  16: 'rnqb7uh0j92f3m48313vi9su9s@group.calendar.google.com',
  17: '0ob1opk660s9dgfeup54ocuhds@group.calendar.google.com',
  18: '0qane9ohnmg1dotl5bdsr9enso@group.calendar.google.com',
  19: 't74k01djde5fr845sh1cfs2g98@group.calendar.google.com',
  20: 'cgf26odr9301kalfpfdebtns1k@group.calendar.google.com',
  21: '2mcbulmlbe8t070dit9t31r56s@group.calendar.google.com',
  22: 'dkhu3ffnnl3jjfb4s0gghj4ua0@group.calendar.google.com',
  23: 'k4g67js1f36d65g6eao7iv5rh4@group.calendar.google.com',
  24: 'ekmsn42cpq2uet8a6bk60v65o8@group.calendar.google.com',
  25: 'eqtli55pme2851d5diamgokps8@group.calendar.google.com',
  26: 'ipjfrqiqk758smn9pbia36j5gc@group.calendar.google.com',
  27: 'a8lb9m0mretkrcnf5fd54aavjc@group.calendar.google.com',
  28: 'd7u46uo0jn88d36m5q95vjmv2g@group.calendar.google.com',
  29: 'gbf94510udq18ggpuodkbiqvvg@group.calendar.google.com',
  30: 'i0eh7qi8ptisfm773pm03uqfio@group.calendar.google.com',
  31: 'td8jnlveg4pbvk5k2tqipqin5s@group.calendar.google.com',
}

const icsUrl = (id) =>
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`

// ---- date helpers (UTC day numbers; all-day dates never touch local time) --

const DAY_MS = 86_400_000
const toDay = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}
const toYmd = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10)
const icsDate = (v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
const mod = (a, n) => ((a % n) + n) % n

// ---- minimal ICS parsing ----------------------------------------------------

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim()
}

function parseIcs(text) {
  const cal = { props: {}, events: [] }
  let ev = null
  for (const line of unfold(text)) {
    if (!line) continue
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue }
    if (line === 'END:VEVENT') { cal.events.push(ev); ev = null; continue }
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const [name] = line.slice(0, colon).split(';')
    const value = line.slice(colon + 1)
    if (!ev) { cal.props[name] = unescapeText(value); continue }
    switch (name) {
      case 'DTSTART': ev.start = icsDate(value); break
      case 'RECURRENCE-ID': ev.recurrenceId = icsDate(value); break
      case 'EXDATE': ev.exdates.push(...value.split(',').map(icsDate)); break
      case 'SUMMARY': ev.summary = unescapeText(value); break
      case 'STATUS': ev.status = value; break
      case 'UID': ev.uid = value; break
      case 'RRULE':
        ev.rrule = Object.fromEntries(value.split(';').map((p) => p.split('=')))
        break
    }
  }
  return cal
}

/** Expands a feed's events into the set of all-day dates inside RANGE. */
function expand(cal, keep) {
  const from = toDay(RANGE.from)
  const to = toDay(RANGE.to)
  const dates = new Map() // ymd -> summary
  const overrides = cal.events.filter((e) => e.recurrenceId)
  for (const ev of cal.events) {
    if (ev.recurrenceId || !keep(ev) || ev.status === 'CANCELLED') continue
    const skip = new Set(ev.exdates)
    for (const o of overrides) if (o.uid === ev.uid) skip.add(o.recurrenceId)
    const start = toDay(ev.start)
    const r = ev.rrule
    if (!r) {
      if (!skip.has(ev.start)) dates.set(ev.start, ev.summary)
      continue
    }
    if (r.FREQ !== 'DAILY') throw new Error(`Unsupported RRULE ${JSON.stringify(r)}`)
    const step = Number(r.INTERVAL ?? 1)
    const until = r.UNTIL ? toDay(icsDate(r.UNTIL)) : Infinity
    const count = r.COUNT ? Number(r.COUNT) : Infinity
    for (let n = start, i = 0; n <= Math.min(to, until) && i < count; n += step, i++) {
      const ymd = toYmd(n)
      if (n >= from && !skip.has(ymd)) dates.set(ymd, ev.summary)
    }
  }
  // Moved / modified single instances.
  for (const o of overrides) {
    if (!keep(o) || o.status === 'CANCELLED') continue
    const n = toDay(o.start)
    if (n >= from && n <= to) dates.set(o.start, o.summary)
  }
  return dates
}

// ---- main -------------------------------------------------------------------

async function load(fromDir, key, id) {
  if (fromDir) return readFile(path.join(fromDir, `tour-${key}.ics`), 'utf8')
  const res = await fetch(icsUrl(id))
  if (!res.ok) throw new Error(`${icsUrl(id)} → HTTP ${res.status}`)
  return res.text()
}

async function main() {
  const i = process.argv.indexOf('--from')
  const fromDir = i > 0 ? process.argv[i + 1] : null

  const isWatch = (ev) => /^watch\s*\d+$/i.test(ev.summary ?? '') || /^W-\d+$/.test(ev.summary ?? '')

  // Watch calendar: W-01..W-31 anchors (first occurrence of each watch).
  const watchCal = parseIcs(await load(fromDir, 'watch', WATCH_CALENDAR))
  const watchAnchors = {}
  for (const ev of watchCal.events) {
    const m = /^W-(\d+)$/.exec(ev.summary ?? '')
    if (m && ev.rrule?.FREQ === 'DAILY' && ev.rrule.INTERVAL === '31') {
      watchAnchors[String(Number(m[1]))] = ev.start
    }
  }

  const calendars = {}
  const tours = {}
  const feedDates = {}
  for (const [tour, id] of Object.entries(TOUR_CALENDARS)) {
    const cal = parseIcs(await load(fromDir, tour, id))
    const dates = expand(cal, isWatch)
    feedDates[tour] = dates
    const desc = cal.props['X-WR-CALDESC'] ?? ''
    calendars[tour] = {
      calendarId: id,
      name: cal.props['X-WR-CALNAME'] ?? '',
      description: desc,
      watches: (desc.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b),
    }
    // First 31-day cycle starting at the epoch (2019-01-01 = Watch 1).
    tours[tour] = [...dates.keys()]
      .filter((d) => toDay(d) - toDay(EPOCH) < 31)
      .sort()
  }

  // Compare every feed against its own first cycle repeated every 31 days and
  // record gaps/extras so defects in the public feeds are visible.
  const anomalies = []
  for (const [tour, first] of Object.entries(tours)) {
    const offsets = new Set(first.map((d) => mod(toDay(d) - toDay(EPOCH), 31)))
    const missing = []
    const extra = []
    for (let n = toDay(RANGE.from); n <= toDay(RANGE.to); n++) {
      const expected = offsets.has(mod(n - toDay(EPOCH), 31))
      const actual = feedDates[tour].has(toYmd(n))
      if (expected && !actual) missing.push(toYmd(n))
      if (!expected && actual) extra.push(toYmd(n))
    }
    if (missing.length || extra.length) {
      anomalies.push({
        tour: Number(tour),
        missingCount: missing.length,
        firstMissing: missing[0] ?? null,
        lastMissing: missing.at(-1) ?? null,
        missingWatches: [...new Set(missing.map((d) => mod(toDay(d) - toDay(EPOCH), 31) + 1))],
        extra,
      })
    }
  }

  const fixture = {
    source: `${PAGE} → linked public Google Calendar ICS feeds (https://calendar.google.com/calendar/ical/<calendarId>/public/basic.ics)`,
    fetchedAt: new Date().toISOString(),
    rule: 'watch(d) = mod(days(2019-01-01 → d), 31) + 1; each tour event is RRULE:FREQ=DAILY;INTERVAL=31',
    range: RANGE,
    watchCalendar: { calendarId: WATCH_CALENDAR, anchors: watchAnchors },
    calendars,
    tours,
    anomalies,
  }
  await writeFile(OUT, JSON.stringify(fixture, null, 2) + '\n')
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
  for (const [tour, first] of Object.entries(tours)) console.log(tour.padStart(2), first.join(' '))
  if (anomalies.length) console.log('anomalies:', JSON.stringify(anomalies, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
