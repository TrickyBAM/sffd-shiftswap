import { describe, expect, it } from 'vitest'
import {
  TEMP_PASSWORD_MIN_LENGTH,
  TEMP_PASSWORD_WORDS,
  generateTempPassword,
  secureRandomInt,
} from '@/app/(app)/admin/_lib/temp-password'
import { firstNameOf, tempPasswordMessage } from '@/app/(app)/admin/members/_lib/password'

const FORMAT = /^([A-Z][a-z]+)-([A-Z][a-z]+)-(\d{4})$/

describe('generateTempPassword', () => {
  it('is Word-Word-1234, at least 12 characters, two different words from the list', () => {
    const words = new Set(TEMP_PASSWORD_WORDS)
    for (let i = 0; i < 500; i++) {
      const password = generateTempPassword()
      const match = FORMAT.exec(password)
      expect(match, password).not.toBeNull()
      expect(password.length).toBeGreaterThanOrEqual(TEMP_PASSWORD_MIN_LENGTH)
      const [, a, b] = match!
      expect(a).not.toBe(b)
      expect(words.has(a.toLowerCase())).toBe(true)
      expect(words.has(b.toLowerCase())).toBe(true)
    }
  })

  it('varies between calls', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTempPassword()))
    expect(seen.size).toBeGreaterThan(45)
  })

  it('uses the random source it is given, and never repeats a word', () => {
    // A generator that always returns 0 would pick the same word twice.
    const password = generateTempPassword(() => 0)
    const [, a, b, digits] = FORMAT.exec(password)!
    expect(a).not.toBe(b)
    expect(digits).toBe('0000')
  })

  it('only uses 5–7 letter words', () => {
    expect(TEMP_PASSWORD_WORDS.length).toBeGreaterThan(50)
    for (const word of TEMP_PASSWORD_WORDS) expect(word).toMatch(/^[a-z]{5,7}$/)
  })
})

describe('secureRandomInt', () => {
  it('stays within [0, max)', () => {
    for (let i = 0; i < 1000; i++) {
      const n = secureRandomInt(7)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(7)
    }
    expect(secureRandomInt(1)).toBe(0)
  })

  it('rejects a bad range', () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError)
    expect(() => secureRandomInt(1.5)).toThrow(RangeError)
  })
})

describe('tempPasswordMessage', () => {
  it('puts the password on its own line and says where to sign in', () => {
    const text = tempPasswordMessage('Mike', 'Harbor-Maple-4821', 'https://shiftswap.example')
    expect(text.split('\n')).toEqual([
      'Hi Mike, I reset your ShiftSwap password. Your temporary password is:',
      'Harbor-Maple-4821',
      "Sign in at https://shiftswap.example/login and you'll be asked to choose a new one.",
    ])
  })

  it('copes with no name and no origin', () => {
    const text = tempPasswordMessage('', 'Harbor-Maple-4821', '')
    expect(text).toContain('Hi there,')
    expect(text).toContain('Sign in to ShiftSwap')
  })

  it('firstNameOf takes the first word', () => {
    expect(firstNameOf('  Mike  Lee ')).toBe('Mike')
    expect(firstNameOf(null)).toBe('')
  })
})
