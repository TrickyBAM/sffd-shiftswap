import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmailAddress, emailBreakPieces } from '@/app/(onboard)/_components/EmailAddress'

// Onboarding's "Signed in as <email>" line: on a phone the address wraps at
// the "@" or a ".", not mid-word (it used break-all before).

describe('emailBreakPieces', () => {
  it('breaks after the @ and before each dot', () => {
    expect(emailBreakPieces('pat.lee@sfgov.org')).toEqual(['pat', '.lee@', 'sfgov', '.org'])
    expect(emailBreakPieces('firefighter1234@gmail.com')).toEqual(['firefighter1234@', 'gmail', '.com'])
  })

  it('keeps the whole address, in order', () => {
    for (const email of ['a@b.co', '.odd@x.y', 'no-at-sign', 'x@y', '']) {
      expect(emailBreakPieces(email).join('')).toBe(email)
    }
    expect(emailBreakPieces('')).toEqual([])
  })
})

describe('EmailAddress', () => {
  it('puts a <wbr> at each break point and falls back to overflow-wrap: anywhere', () => {
    const html = renderToStaticMarkup(createElement(EmailAddress, { email: 'pat.lee@sfgov.org', className: 'text-fg' }))
    expect(html).toBe('<span class="wrap-anywhere text-fg">pat<wbr/>.lee@<wbr/>sfgov<wbr/>.org</span>')
    expect(html).not.toContain('break-all')
  })
})
