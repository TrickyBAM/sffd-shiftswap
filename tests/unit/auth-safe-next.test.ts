import { describe, expect, it } from 'vitest'
import { nextFromSearchParam, safeNextPath } from '@/app/(auth)/_lib/safe-next'
import { safeNextPath as proxySafeNextPath } from '@/lib/supabase/session'

const CASES: Array<[string | null | undefined, string | null]> = [
  ['/board?shift=abc', '/board?shift=abc'],
  ['/trades/123#chat', '/trades/123#chat'],
  ['/calendar', '/calendar'],
  ['/admin/members?q=smith', '/admin/members?q=smith'],
  [null, null],
  [undefined, null],
  ['', null],
  ['calendar', null],
  ['https://evil.example/', null],
  ['//evil.example/path', null],
  ['/\\evil.example', null],
  ['/\tevil', null],
  ['/%0d%0aSet-Cookie:x', '/%0d%0aSet-Cookie:x'],
  ['/login', null],
  ['/login?next=/board', null],
  ['/signup', null],
  ['/signup/extra', null],
  ['/loginx', '/loginx'],
  ['javascript:alert(1)', null],
]

describe('safeNextPath (login ?next=)', () => {
  it.each(CASES)('%j → %j', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })

  it('agrees with the proxy', () => {
    for (const [input] of CASES) {
      expect(safeNextPath(input)).toBe(proxySafeNextPath(input))
    }
  })

  it('reads the first value of a repeated search param', () => {
    expect(nextFromSearchParam(['/board', '/trades'])).toBe('/board')
    expect(nextFromSearchParam('//evil.example')).toBeNull()
    expect(nextFromSearchParam(undefined)).toBeNull()
  })
})
