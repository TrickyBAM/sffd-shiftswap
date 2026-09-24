import { describe, expect, it } from 'vitest'
import {
  fullNameSchema,
  loginSchema,
  onboardingSchema,
  signupFormSchema,
  signupRequestSchema,
} from '@/app/(auth)/_lib/validation'
import {
  fullNameError,
  PASSWORD_MAX,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  PHONE_INVALID_MESSAGE,
  PHONE_REQUIRED_MESSAGE,
} from '@/lib/validation'

function firstError(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  const issue = result.error?.issues[0]
  return issue ? { path: issue.path.join('.'), message: issue.message } : null
}

// The field rules come from '@/lib/validation' (tested in lib-validation);
// these check the auth forms use them rather than their own copies (CC-6).
describe('shared field rules', () => {
  it('collapses whitespace in names and uses the shared name messages', () => {
    expect(fullNameSchema.parse('  Mary   Ann  Smith ')).toBe('Mary Ann Smith')
    expect(firstError(fullNameSchema.safeParse(' P '))?.message).toBe(fullNameError('P'))
    expect(firstError(fullNameSchema.safeParse('x'.repeat(81)))?.message).toBe(fullNameError('x'.repeat(81)))
  })

  it('accepts phone formats the database accepts', () => {
    const valid = { fullName: 'Pat Firefighter', rank: 'Captain', station: 19, tour: 7, employeeId: '' }
    for (const phone of ['415-555-0123', '(415) 555 0123', '+1 415 555 0123', '4155550123']) {
      expect(onboardingSchema.safeParse({ ...valid, phone }).success, phone).toBe(true)
    }
  })

  it('rejects the phones every other form rejects, including too few digits', () => {
    const valid = { fullName: 'Pat Firefighter', rank: 'Captain', station: 19, tour: 7, employeeId: '' }
    // '555 12 3' is the review's admin-form case: 8 characters, only 6 digits.
    for (const phone of ['555', '555 12 3', '415.555.0123', 'call me', '+-() -+()', '1'.repeat(21)]) {
      const result = onboardingSchema.safeParse({ ...valid, phone })
      expect(firstError(result), phone).toEqual({ path: 'phone', message: PHONE_INVALID_MESSAGE })
    }
    expect(firstError(onboardingSchema.safeParse({ ...valid, phone: '  ' }))).toEqual({
      path: 'phone',
      message: PHONE_REQUIRED_MESSAGE,
    })
  })
})

describe('login', () => {
  it('lower-cases and trims the email', () => {
    const parsed = loginSchema.parse({ email: '  Brian@Example.COM ', password: 'x' })
    expect(parsed.email).toBe('brian@example.com')
  })

  it('needs a password and a valid email', () => {
    expect(firstError(loginSchema.safeParse({ email: 'nope', password: 'x' }))?.path).toBe('email')
    expect(firstError(loginSchema.safeParse({ email: 'a@b.co', password: '' }))?.path).toBe('password')
  })
})

describe('sign-up', () => {
  const valid = {
    fullName: 'Pat  Firefighter',
    email: 'pat@example.com',
    phone: '415-555-0123',
    password: 'correct horse',
    confirmPassword: 'correct horse',
  }

  it('accepts a complete form', () => {
    const parsed = signupFormSchema.parse(valid)
    expect(parsed.fullName).toBe('Pat Firefighter')
  })

  it('needs 8 to 72 characters of password', () => {
    const result = signupFormSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' })
    expect(firstError(result)).toEqual({ path: 'password', message: PASSWORD_TOO_SHORT_MESSAGE })
    expect(PASSWORD_TOO_SHORT_MESSAGE).toBe('Use at least 8 characters.')
    const long = 'x'.repeat(PASSWORD_MAX + 1)
    expect(firstError(signupFormSchema.safeParse({ ...valid, password: long, confirmPassword: long }))).toEqual({
      path: 'password',
      message: PASSWORD_TOO_LONG_MESSAGE,
    })
  })

  it('needs matching passwords', () => {
    const result = signupFormSchema.safeParse({ ...valid, confirmPassword: 'something else' })
    expect(firstError(result)).toEqual({ path: 'confirmPassword', message: PASSWORD_MISMATCH_MESSAGE })
  })

  it('needs a real name', () => {
    expect(firstError(signupFormSchema.safeParse({ ...valid, fullName: ' P ' }))?.path).toBe('fullName')
  })

  it('checks the server request too (honeypot defaults to empty)', () => {
    const parsed = signupRequestSchema.parse({ ...valid, token: 't' })
    expect(parsed.hp).toBe('')
    expect(signupRequestSchema.safeParse({ ...valid, token: 't', password: 'short' }).success).toBe(false)
  })
})

describe('onboarding', () => {
  const valid = {
    fullName: 'Pat Firefighter',
    phone: '415-555-0123',
    rank: 'Captain',
    station: 19,
    tour: 7,
    employeeId: '',
  }

  it('accepts a tour or "No tour"', () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true)
    expect(onboardingSchema.safeParse({ ...valid, tour: null }).success).toBe(true)
  })

  it('requires a tour choice (undefined = not chosen yet)', () => {
    const result = onboardingSchema.safeParse({ ...valid, tour: undefined })
    expect(firstError(result)?.path).toBe('tour')
    expect(onboardingSchema.safeParse({ ...valid, tour: 32 }).success).toBe(false)
  })

  it('requires a real rank and station', () => {
    expect(firstError(onboardingSchema.safeParse({ ...valid, rank: '' }))?.message).toBe('Choose your rank.')
    expect(firstError(onboardingSchema.safeParse({ ...valid, station: null }))?.message).toBe('Choose your station.')
    expect(onboardingSchema.safeParse({ ...valid, station: 99 }).success).toBe(false)
    expect(onboardingSchema.safeParse({ ...valid, station: 101 }).success).toBe(true)
  })

  it('trims the optional employee ID and caps its length', () => {
    expect(onboardingSchema.parse({ ...valid, employeeId: '  E123 ' }).employeeId).toBe('E123')
    expect(onboardingSchema.safeParse({ ...valid, employeeId: 'x'.repeat(41) }).success).toBe(false)
  })
})

