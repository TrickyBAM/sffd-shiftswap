import { describe, expect, it } from 'vitest'
import { acceptLimitLabel, dialablePhone, plural, relativeTime, smsHref, telHref, tourLabel } from '@/lib/format'

describe('relativeTime', () => {
  // 2026-09-23 12:00 Pacific (PDT)
  const now = Date.parse('2026-09-23T19:00:00Z')

  it('uses short relative wording', () => {
    expect(relativeTime('2026-09-23T18:59:30Z', now)).toBe('Just now')
    expect(relativeTime('2026-09-23T18:55:00Z', now)).toBe('5 min ago')
    expect(relativeTime('2026-09-23T16:00:00Z', now)).toBe('3 hr ago')
    expect(relativeTime('2026-09-23T16:00:00Z', new Date(now))).toBe('3 hr ago')
  })

  it('counts calendar days in Pacific time', () => {
    // 2026-09-22 08:00 Pacific: yesterday, 28 hours ago.
    expect(relativeTime('2026-09-22T15:00:00Z', now)).toBe('Yesterday')
    expect(relativeTime('2026-09-19T19:00:00Z', now)).toBe('4 days ago')
    expect(relativeTime('2026-09-02T19:00:00Z', now)).toBe('Sep 2')
    expect(relativeTime('2025-12-30T19:00:00Z', now)).toBe('Dec 30, 2025')
  })

  it('never says "yesterday" for earlier today, and 31 hours over two nights is 2 days', () => {
    // 23.5 hours ago but still today in Pacific time (00:30 → 23:59 the same day).
    const lateToday = Date.parse('2026-09-24T06:59:00Z') // 23:59 PDT on Sep 23
    expect(relativeTime('2026-09-23T07:30:00Z', lateToday)).toBe('23 hr ago')
    // 1 AM two days ago, seen at 8 AM.
    const eightAm = Date.parse('2026-09-23T15:00:00Z')
    expect(relativeTime('2026-09-21T08:00:00Z', eightAm)).toBe('2 days ago')
  })

  it('inline style fits mid-sentence', () => {
    expect(relativeTime('2026-09-23T18:59:30Z', now, { style: 'inline' })).toBe('just now')
    expect(relativeTime('2026-09-22T15:00:00Z', now, { style: 'inline' })).toBe('yesterday')
    expect(relativeTime('2026-09-02T19:00:00Z', now, { style: 'inline' })).toBe('on Sep 2')
  })

  it('handles missing, invalid and future times', () => {
    expect(relativeTime(null, now)).toBe('')
    expect(relativeTime('not a date', now)).toBe('')
    expect(relativeTime('2026-09-23T19:05:00Z', now)).toBe('Just now')
  })
})

describe('plural', () => {
  it('picks the word and formats the number', () => {
    expect(plural(1, 'shift')).toBe('1 shift')
    expect(plural(0, 'shift')).toBe('0 shifts')
    expect(plural(3, 'person', 'people')).toBe('3 people')
    expect(plural(1204, 'member')).toBe('1,204 members')
  })
})

describe('phone links', () => {
  it('keeps digits and a leading +, and needs 7 digits', () => {
    expect(dialablePhone(' (415) 555-0123 ')).toBe('4155550123')
    expect(dialablePhone('+1 415 555 0123')).toBe('+14155550123')
    expect(dialablePhone('555 12 3')).toBe('')
    expect(dialablePhone(null)).toBe('')
  })

  it('builds tel: and sms: links', () => {
    expect(telHref('415-555-0123')).toBe('tel:4155550123')
    expect(telHref('12')).toBeNull()
    expect(smsHref('415-555-0123')).toBe('sms:4155550123')
    expect(smsHref('415-555-0123', 'Hi & thanks')).toBe('sms:4155550123?&body=Hi%20%26%20thanks')
    expect(smsHref('')).toBeNull()
  })
})

describe('labels', () => {
  it('tourLabel', () => {
    expect(tourLabel(7)).toBe('Tour 7')
    expect(tourLabel(null)).toBe('No tour')
    expect(tourLabel(40)).toBe('No tour')
  })

  it('acceptLimitLabel is relative to the shift station', () => {
    expect(acceptLimitLabel('anyone', 19)).toBeNull()
    expect(acceptLimitLabel('station', 19)).toBe('Station 19 only')
    expect(acceptLimitLabel('battalion', 19)).toBe('Battalion 9 only')
    expect(acceptLimitLabel('division', 19)).toBe('Division 3 only')
    expect(acceptLimitLabel('battalion', null)).toBe('Same battalion only')
    expect(acceptLimitLabel('nonsense', 19)).toBeNull()
  })
})
