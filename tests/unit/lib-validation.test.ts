import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  cleanName,
  employeeIdError,
  fullNameError,
  isValidNewPassword,
  isValidPhone,
  newPasswordError,
  newPasswordSchema,
  PASSWORD_MAX,
  PASSWORD_MIN,
  PHONE_INVALID_MESSAGE,
  PHONE_RE,
  PHONE_REQUIRED_MESSAGE,
  phoneError,
  phoneSchema,
} from '@/lib/validation'
import { extractSqlFunction } from './helpers/sql-functions'

describe('phone rule', () => {
  it('matches private.valid_phone() character and length rules', () => {
    // The regex is the one in the migration.
    const sql = extractSqlFunction('private.valid_phone') ?? ''
    expect(sql).toContain(PHONE_RE.source)
  })

  it('accepts real numbers and needs 7 digits', () => {
    for (const ok of ['415-555-0123', '(415) 555-0123', '+1 415 555 0123', '5550123', ' 415 555 0123 ']) {
      expect(isValidPhone(ok), ok).toBe(true)
      expect(phoneError(ok), ok).toBeNull()
    }
    // The admin-form case from the review: 8 characters, only 6 digits.
    for (const bad of ['555 12 3', '((((((((', '415.555.0123', 'call me', '1'.repeat(21)]) {
      expect(isValidPhone(bad), bad).toBe(false)
      expect(phoneError(bad), bad).toBe(PHONE_INVALID_MESSAGE)
    }
    expect(phoneError('  ')).toBe(PHONE_REQUIRED_MESSAGE)
    expect(phoneError(null)).toBe(PHONE_REQUIRED_MESSAGE)
  })

  it('zod schema trims and uses the same messages', () => {
    expect(phoneSchema.parse(' 415-555-0123 ')).toBe('415-555-0123')
    expect(phoneSchema.safeParse('').error?.issues[0].message).toBe(PHONE_REQUIRED_MESSAGE)
    expect(phoneSchema.safeParse('555 12 3').error?.issues[0].message).toBe(PHONE_INVALID_MESSAGE)
  })
})

describe('password rule', () => {
  it('8 to 72 characters, spaces count', () => {
    expect(PASSWORD_MIN).toBe(8)
    expect(PASSWORD_MAX).toBe(72)
    expect(newPasswordError('short')).toMatch(/at least 8/)
    expect(newPasswordError('x'.repeat(73))).toMatch(/72 characters or fewer/)
    expect(newPasswordError('        ')).toBeNull()
    expect(isValidNewPassword('correct horse')).toBe(true)
    expect(newPasswordSchema.safeParse('x'.repeat(72)).success).toBe(true)
  })

  it('change-password form needs a matching confirmation', () => {
    expect(changePasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'longenough' }).success).toBe(true)
    const mismatch = changePasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'different1' })
    expect(mismatch.error?.issues[0]).toMatchObject({ path: ['confirmPassword'], message: "The two passwords don't match." })
    const blank = changePasswordSchema.safeParse({ password: 'longenough', confirmPassword: '' })
    expect(blank.error?.issues[0].message).toBe('Type your new password again.')
  })
})

describe('name and employee ID', () => {
  it('cleans and checks names like the database', () => {
    expect(cleanName('  Ana   Cruz ')).toBe('Ana Cruz')
    expect(fullNameError('A')).not.toBeNull()
    expect(fullNameError('Ana Cruz')).toBeNull()
    expect(fullNameError('x'.repeat(81))).not.toBeNull()
  })

  it('employee ID is optional and at most 40 characters', () => {
    expect(employeeIdError('')).toBeNull()
    expect(employeeIdError('E12345')).toBeNull()
    expect(employeeIdError('x'.repeat(41))).not.toBeNull()
  })
})
