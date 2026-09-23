import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  cleanName,
  isValidPhone,
  loginSchema,
  onboardingSchema,
  signupFormSchema,
  signupRequestSchema,
} from '@/app/(auth)/_lib/validation'

function firstError(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  const issue = result.error?.issues[0]
  return issue ? { path: issue.path.join('.'), message: issue.message } : null
}

describe('names and phones (mirror the database checks)', () => {
  it('collapses whitespace in names', () => {
    expect(cleanName('  Mary   Ann  Smith ')).toBe('Mary Ann Smith')
  })

  it('accepts phone formats the database accepts', () => {
    for (const phone of ['415-555-0123', '(415) 555 0123', '+1 415 555 0123', '4155550123']) {
      expect(isValidPhone(phone), phone).toBe(true)
    }
  })

  it('rejects phones the database would reject or that have too few digits', () => {
    for (const phone of ['', '555', '415.555.0123', 'call me', '+-() -+()', '1'.repeat(21)]) {
      expect(isValidPhone(phone), phone).toBe(false)
    }
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

  it('needs at least 8 characters of password', () => {
    const result = signupFormSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' })
    expect(firstError(result)).toEqual({ path: 'password', message: 'Use at least 8 characters.' })
  })

  it('needs matching passwords', () => {
    const result = signupFormSchema.safeParse({ ...valid, confirmPassword: 'something else' })
    expect(firstError(result)?.path).toBe('confirmPassword')
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

describe('forced password change', () => {
  it('needs 8+ characters and a matching confirmation', () => {
    expect(changePasswordSchema.safeParse({ password: 'new password', confirmPassword: 'new password' }).success).toBe(true)
    expect(firstError(changePasswordSchema.safeParse({ password: 'short', confirmPassword: 'short' }))?.path).toBe('password')
    expect(firstError(changePasswordSchema.safeParse({ password: 'new password', confirmPassword: 'other' }))?.path).toBe(
      'confirmPassword',
    )
  })
})
