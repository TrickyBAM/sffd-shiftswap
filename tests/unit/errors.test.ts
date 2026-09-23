import { describe, expect, it } from 'vitest'
import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  AuthWeakPasswordError,
  PostgrestError,
} from '@supabase/supabase-js'
import {
  APP_ERROR_CODES,
  AppError,
  errorMessage,
  friendlyMessage,
  GENERIC_MESSAGE,
  isAppError,
  isAppErrorCode,
  isNetworkError,
  NETWORK_MESSAGE,
  toAppError,
} from '@/lib/errors'
import { MissingEnvError } from '@/lib/env'
import { ERROR_HINTS } from '@/lib/types/database'

/** What supabase-js returns as `error` when fetch() itself rejects (status 0). */
function fetchFailure(message: string) {
  return { message, details: 'TypeError: …stack…', hint: '', code: '' }
}

// Text that must never reach a member.
const RAW_TEXT_RE = /[{}<>]|PGRST|Unexpected token|TypeError|SyntaxError|FetchError|JSON|undefined|\bnull\b|\[object/i

describe('AppError', () => {
  it('defaults its message from the code', () => {
    const e = new AppError('NOT_OPEN')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('AppError')
    expect(e.code).toBe('NOT_OPEN')
    expect(e.message).toBe(friendlyMessage('NOT_OPEN'))
    expect(e.status).toBeNull()
    expect(e.details).toBeNull()
    expect(e.isNetwork).toBe(false)
  })

  it('keeps a custom message, status, details and cause', () => {
    const cause = new Error('boom')
    const e = new AppError('NETWORK', 'Offline', { cause, status: 0, details: 'x' })
    expect(e.message).toBe('Offline')
    expect(e.status).toBe(0)
    expect(e.details).toBe('x')
    expect(e.cause).toBe(cause)
    expect(e.isNetwork).toBe(true)
  })

  it('serializes to {name, code, message} and toAppError reads it back', () => {
    const e = new AppError('ALREADY_POSTED', 'You already posted your Wed Sep 23 shift.')
    const plain = JSON.parse(JSON.stringify(e))
    expect(plain).toEqual({ name: 'AppError', code: 'ALREADY_POSTED', message: 'You already posted your Wed Sep 23 shift.' })
    const back = toAppError(plain)
    expect(back).toBeInstanceOf(AppError)
    expect(back.code).toBe('ALREADY_POSTED')
    expect(back.message).toBe('You already posted your Wed Sep 23 shift.')
  })

  it('isAppError accepts AppErrors only', () => {
    expect(isAppError(new AppError('UNKNOWN'))).toBe(true)
    const foreign = Object.assign(new Error('Nope'), { name: 'AppError', code: 'NOT_FOUND' })
    expect(isAppError(foreign)).toBe(true)
    expect(isAppError({ name: 'AppError', code: 'NOT_FOUND', message: 'x' })).toBe(false)
    expect(isAppError(new Error('x'))).toBe(false)
    expect(isAppError(null)).toBe(false)
  })
})

describe('friendlyMessage', () => {
  it('has a plain-English default for every hint code, NETWORK and UNKNOWN', () => {
    expect(APP_ERROR_CODES).toEqual([...ERROR_HINTS, 'NETWORK', 'UNKNOWN'])
    for (const code of APP_ERROR_CODES) {
      const message = friendlyMessage(code)
      expect(message, code).toMatch(/^[A-Z].+[.!]$/)
      expect(message, code).not.toMatch(RAW_TEXT_RE)
      expect(message, code).not.toMatch(/RPC|NOSIGNAL|hint/)
    }
  })

  it('uses the exact network sentence', () => {
    expect(friendlyMessage('NETWORK')).toBe("Can't reach ShiftSwap right now. Check your connection and try again.")
    expect(NETWORK_MESSAGE).toBe(friendlyMessage('NETWORK'))
  })

  it('falls back to the generic message for unknown codes', () => {
    expect(friendlyMessage('WHATEVER')).toBe(GENERIC_MESSAGE)
    expect(friendlyMessage(null)).toBe(GENERIC_MESSAGE)
  })

  it('isAppErrorCode', () => {
    expect(isAppErrorCode('LAST_ADMIN')).toBe(true)
    expect(isAppErrorCode('NETWORK')).toBe(true)
    expect(isAppErrorCode('P0001')).toBe(false)
    expect(isAppErrorCode('invalid_credentials')).toBe(false)
  })
})

describe('toAppError: RPC rule failures (P0001 + hint)', () => {
  it('keeps the database message and uses the hint as the code', () => {
    const e = toAppError(
      { code: 'P0001', message: 'This shift is no longer open.', details: null, hint: 'NOT_OPEN' },
      { status: 400 },
    )
    expect(e.code).toBe('NOT_OPEN')
    expect(e.message).toBe('This shift is no longer open.')
    expect(e.status).toBe(400)
    expect(e.details).toContain('P0001')
  })

  it('works with a real PostgrestError instance', () => {
    const e = toAppError(
      new PostgrestError({ code: 'P0001', message: "You're working on Thu Sep 24.", details: '', hint: 'YOU_WORK_THAT_DAY' }),
    )
    expect(e.code).toBe('YOU_WORK_THAT_DAY')
    expect(e.message).toBe("You're working on Thu Sep 24.")
  })

  it('maps every §6.6 hint', () => {
    for (const hint of ERROR_HINTS) {
      const e = toAppError({ code: 'P0001', message: 'Friendly text.', details: null, hint })
      expect(e.code).toBe(hint)
      expect(e.message).toBe('Friendly text.')
    }
  })

  it('falls back to the default message when the message is unusable', () => {
    expect(toAppError({ code: 'P0001', message: '{}', hint: 'NOT_FOUND' }).message).toBe(friendlyMessage('NOT_FOUND'))
    expect(toAppError({ code: 'P0001', message: '', hint: 'STARTED' }).message).toBe(friendlyMessage('STARTED'))
  })

  it('never treats a database message as a network failure', () => {
    const e = toAppError({ code: 'P0001', message: 'The request was terminated: network error', hint: 'NOT_OPEN' })
    expect(e.code).toBe('NOT_OPEN')
    const unknownHint = toAppError({ code: 'P0001', message: 'Load failed because the roster is empty.', hint: 'SOMETHING' })
    expect(unknownHint.code).toBe('UNKNOWN')
    expect(unknownHint.message).toBe('Load failed because the roster is empty.')
  })

  it('P0001 without a known hint keeps a readable message as UNKNOWN', () => {
    const e = toAppError({ code: 'P0001', message: 'Something custom happened.', hint: null })
    expect(e.code).toBe('UNKNOWN')
    expect(e.message).toBe('Something custom happened.')
  })
})

describe('toAppError: network and paused backend', () => {
  it.each([
    'TypeError: Failed to fetch', // Chrome, via supabase-js
    'TypeError: NetworkError when attempting to fetch resource.', // Firefox
    'TypeError: Load failed', // Safari
    'TypeError: fetch failed', // Node / undici
    'FetchError: The network connection was lost.',
    'The Internet connection appears to be offline.',
  ])('supabase-js fetch failure %j → NETWORK', (message) => {
    const e = toAppError(fetchFailure(message), { status: 0 })
    expect(e.code).toBe('NETWORK')
    expect(e.message).toBe(NETWORK_MESSAGE)
    expect(e.status).toBe(0)
  })

  it('status 0 alone means no response', () => {
    expect(toAppError({ message: '', details: '', hint: '', code: '' }, { status: 0 }).code).toBe('NETWORK')
  })

  it.each([
    new TypeError('Failed to fetch'),
    new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) }),
    new Error('getaddrinfo ENOTFOUND abc.supabase.co'),
    new Error('socket hang up'),
  ])('thrown %s → NETWORK', (error) => {
    expect(toAppError(error).code).toBe('NETWORK')
  })

  it('HTML error pages (paused project, gateway) → NETWORK, never the HTML', () => {
    const html = '<!DOCTYPE html><html><head><title>503 Service Unavailable</title></head><body>paused</body></html>'
    for (const status of [200, 404, 500, 503]) {
      const e = toAppError({ message: html }, { status })
      expect(e.code).toBe('NETWORK')
      expect(e.message).toBe(NETWORK_MESSAGE)
    }
    expect(toAppError({ message: '<html><body>Bad Gateway</body></html>' }).code).toBe('NETWORK')
  })

  it.each([
    new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`),
    new SyntaxError('JSON.parse: unexpected character at line 1 column 1 of the JSON data'),
    new SyntaxError('Unexpected end of JSON input'),
    "Unexpected token '<'",
  ])('JSON parse failures from HTML bodies → NETWORK (%s)', (error) => {
    const e = toAppError(error)
    expect(e.code).toBe('NETWORK')
    expect(e.message).toBe(NETWORK_MESSAGE)
  })

  it.each([502, 503, 504, 520, 522, 540])('gateway status %i without a database code → NETWORK', (status) => {
    expect(toAppError({ message: 'upstream error' }, { status }).code).toBe('NETWORK')
    expect(toAppError({}, { status }).code).toBe('NETWORK')
  })

  it.each(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '08006', '08001', '53300', '57P01', '57P03'])(
    'database unavailable code %s → NETWORK',
    (code) => {
      expect(toAppError({ code, message: 'Database client error. Retrying the connection.', hint: null }, { status: 503 }).code).toBe(
        'NETWORK',
      )
    },
  )

  it('aborted and timed-out requests → NETWORK', () => {
    expect(toAppError(new DOMException('The operation was aborted.', 'AbortError')).code).toBe('NETWORK')
    expect(toAppError(new DOMException('Signal timed out.', 'TimeoutError')).code).toBe('NETWORK')
    expect(
      toAppError(
        { message: 'AbortError: This operation was aborted', details: '', hint: 'Request was aborted (timeout or manual cancellation)', code: '' },
        { status: 0 },
      ).code,
    ).toBe('NETWORK')
  })

  it('auth fetch failures → NETWORK', () => {
    expect(toAppError(new AuthRetryableFetchError('Failed to fetch', 0)).code).toBe('NETWORK')
    expect(toAppError(new AuthUnknownError("Unexpected token '<'", new SyntaxError('x'))).code).toBe('NETWORK')
  })
})

describe('toAppError: Postgres / PostgREST codes', () => {
  it.each([
    ['PGRST301', 401, 'NOT_SIGNED_IN'],
    ['PGRST302', 401, 'NOT_SIGNED_IN'],
    ['PGRST303', 401, 'NOT_SIGNED_IN'],
    ['PGRST116', 406, 'NOT_FOUND'],
    ['PGRST202', 404, 'UNKNOWN'],
    ['PGRST205', 404, 'UNKNOWN'],
    ['42883', 404, 'UNKNOWN'],
    ['42501', 401, 'NOT_SIGNED_IN'],
    ['42501', 403, 'UNKNOWN'],
    ['23505', 409, 'INVALID_INPUT'],
    ['23503', 409, 'INVALID_INPUT'],
    ['23514', 400, 'INVALID_INPUT'],
    ['23502', 400, 'INVALID_INPUT'],
    ['22P02', 400, 'INVALID_INPUT'],
    ['22007', 400, 'INVALID_INPUT'],
    ['22001', 400, 'INVALID_INPUT'],
    ['57014', 500, 'UNKNOWN'],
    ['40001', 500, 'UNKNOWN'],
    ['40P01', 500, 'UNKNOWN'],
    ['XX000', 500, 'UNKNOWN'],
  ] as const)('%s (HTTP %i) → %s with a friendly message', (code, status, expected) => {
    const raw = {
      code,
      message: `new row for relation "shifts" violates check constraint "x" ${code}`,
      details: 'Failing row contains (…)',
      hint: null,
    }
    const e = toAppError(raw, { status })
    expect(e.code).toBe(expected)
    expect(e.message).not.toMatch(RAW_TEXT_RE)
    expect(e.message).not.toContain('relation')
    expect(e.message).not.toContain(code)
    expect(e.details).toContain(code)
  })

  it('specific wording for common cases', () => {
    expect(toAppError({ code: 'PGRST303', message: 'JWT expired' }, { status: 401 }).message).toBe(
      'Your session has expired. Please sign in again.',
    )
    expect(toAppError({ code: '42501', message: 'permission denied for table roster' }, { status: 403 }).message).toBe(
      "You don't have permission to do that.",
    )
    expect(toAppError({ code: '57014', message: 'canceling statement due to statement timeout' }).message).toBe(
      'ShiftSwap took too long to answer. Please try again.',
    )
    expect(toAppError({ code: 'PGRST202', message: 'Could not find the function public.my_stats' }).message).toMatch(
      /isn't set up yet/,
    )
  })

  it('HTTP status alone', () => {
    expect(toAppError({ message: 'x' }, { status: 401 }).code).toBe('NOT_SIGNED_IN')
    expect(toAppError({ message: 'x' }, { status: 403 }).message).toBe("You don't have permission to do that.")
    expect(toAppError({ message: 'x' }, { status: 429 }).message).toMatch(/Too many attempts/)
    expect(toAppError({ message: 'Internal Server Error' }, { status: 500 }).code).toBe('UNKNOWN')
  })
})

describe('toAppError: auth errors', () => {
  it('maps common auth API codes', () => {
    const wrong = toAppError(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'))
    expect(wrong.code).toBe('INVALID_INPUT')
    expect(wrong.message).toBe("That email and password don't match.")

    expect(toAppError(new AuthWeakPasswordError('Password is too weak', 422, ['length'])).code).toBe('INVALID_INPUT')
    expect(toAppError(new AuthApiError('User already registered', 422, 'user_already_exists')).message).toMatch(/already exists/)
    expect(toAppError(new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit')).message).toMatch(
      /Too many attempts/,
    )
    expect(toAppError(new AuthApiError('User is banned', 400, 'user_banned')).code).toBe('NOT_APPROVED')
    expect(toAppError(new AuthApiError('Session not found', 403, 'session_not_found')).code).toBe('NOT_SIGNED_IN')
  })

  it('signed-out auth errors → NOT_SIGNED_IN', () => {
    expect(toAppError(new AuthSessionMissingError()).code).toBe('NOT_SIGNED_IN')
    expect(toAppError(new AuthInvalidJwtError('Invalid JWT signature')).code).toBe('NOT_SIGNED_IN')
  })
})

describe('toAppError: garbage in, friendly out', () => {
  it.each([
    [{}],
    ['{}'],
    [{ message: '{}' }],
    [{ message: '{"code":"XX","message":"boom"}' }],
    [{ message: '[object Object]' }],
    [null],
    [undefined],
    [42],
    [new Error('Cannot read properties of undefined (reading "id")')],
    [new RangeError('Invalid time value')],
    [{ error: 'weird' }],
  ])('%j → UNKNOWN with the generic message', (input) => {
    const e = toAppError(input)
    expect(e).toBeInstanceOf(AppError)
    expect(e.code).toBe('UNKNOWN')
    expect(e.message).toBe(GENERIC_MESSAGE)
  })

  it('never produces a raw message for any of these inputs', () => {
    const inputs: unknown[] = [
      {},
      '{}',
      { message: '<!doctype html><title>x</title>' },
      { message: 'TypeError: Failed to fetch', code: '', hint: '', details: '' },
      new SyntaxError("Unexpected token '<'"),
      { code: 'PGRST100', message: '"failed to parse filter (eq)" (line 1, column 4)' },
      { code: '22P02', message: 'invalid input syntax for type uuid: "abc"' },
      { code: 'P0001', message: '{"a":1}', hint: 'NOT_FOUND' },
      new Error('Error: something at foo (bar.js:1:2)'),
    ]
    for (const input of inputs) {
      expect(toAppError(input).message, JSON.stringify(String(input))).not.toMatch(RAW_TEXT_RE)
    }
  })

  it('returns the same AppError instance unchanged', () => {
    const e = new AppError('LAST_ADMIN')
    expect(toAppError(e)).toBe(e)
  })

  it('keeps a missing-configuration message (it says what to set)', () => {
    const env = new MissingEnvError('Supabase is not configured: missing NEXT_PUBLIC_SUPABASE_URL.', ['NEXT_PUBLIC_SUPABASE_URL'])
    const e = toAppError(env)
    expect(e.code).toBe('UNKNOWN')
    expect(e.message).toBe(env.message)
    expect(e.cause).toBe(env)
  })

  it('keeps the original error as cause and technical detail for logs', () => {
    const raw = { code: '23505', message: 'duplicate key value violates unique constraint "x"', details: 'Key (endpoint)=(…)', hint: null }
    const e = toAppError(raw, { status: 409 })
    expect(e.cause).toBe(raw)
    expect(e.status).toBe(409)
    expect(e.details).toContain('duplicate key')
    expect(e.details).toContain('HTTP 409')
  })

  it('truncates very long technical details', () => {
    const e = toAppError({ code: 'XX000', message: 'x'.repeat(5000) })
    expect(e.details!.length).toBeLessThanOrEqual(1000)
  })
})

describe('helpers', () => {
  it('errorMessage and isNetworkError', () => {
    expect(errorMessage({ code: 'P0001', message: 'Choose your rank.', hint: 'INVALID_INPUT' })).toBe('Choose your rank.')
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_MESSAGE)
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
    expect(isNetworkError({ code: 'P0001', message: 'x', hint: 'NOT_OPEN' })).toBe(false)
  })
})
