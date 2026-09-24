// One set of form rules for every screen that edits the same data: sign-up,
// onboarding, Profile ▸ Edit details, the admin member editor and both
// password changes (CC-6). Each rule is exported as a plain validator (returns
// the problem in plain English, or null) and as a zod schema for
// react-hook-form, so the messages never drift apart.
//
// The phone rule mirrors the database — private.valid_phone(): after trimming,
// 7 to 20 characters of digits, spaces, +, -, ( and ) — and adds one thing the
// database doesn't check: at least 7 digits, so every saved number can be
// called and texted (tel:/sms: links need 7+ digits, see dialablePhone()).
// Pure module: safe in the browser, on the server and in tests.

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/** The characters and length private.valid_phone() accepts (after trimming). */
export const PHONE_RE = /^[0-9+() -]{7,20}$/

/** Fewest digits a phone number needs to be callable. */
export const PHONE_MIN_DIGITS = 7

export const PHONE_REQUIRED_MESSAGE = 'Enter a mobile number.'
export const PHONE_INVALID_MESSAGE = 'Enter a phone number with area code, like 415-555-0123.'

/** Number of digits in a phone number. */
export function phoneDigits(value: string | null | undefined): number {
  return (value ?? '').replace(/\D/g, '').length
}

/** True for a phone number the database accepts that also has at least 7 digits. */
export function isValidPhone(value: string | null | undefined): boolean {
  const phone = (value ?? '').trim()
  return PHONE_RE.test(phone) && phoneDigits(phone) >= PHONE_MIN_DIGITS
}

/** The problem with a phone number (required), or null when it can be saved. */
export function phoneError(value: string | null | undefined): string | null {
  const phone = (value ?? '').trim()
  if (!phone) return PHONE_REQUIRED_MESSAGE
  return isValidPhone(phone) ? null : PHONE_INVALID_MESSAGE
}

/** zod: a required phone number, trimmed. */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, PHONE_REQUIRED_MESSAGE)
  .refine(isValidPhone, PHONE_INVALID_MESSAGE)

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export const PASSWORD_MIN = 8
/** Supabase Auth (bcrypt) ignores anything past 72 characters. */
export const PASSWORD_MAX = 72

export const PASSWORD_TOO_SHORT_MESSAGE = `Use at least ${PASSWORD_MIN} characters.`
export const PASSWORD_TOO_LONG_MESSAGE = `Use ${PASSWORD_MAX} characters or fewer.`
export const PASSWORD_CONFIRM_MESSAGE = 'Type your new password again.'
export const PASSWORD_MISMATCH_MESSAGE = "The two passwords don't match."

/** The problem with a new password, or null when it's allowed. Not trimmed: spaces count. */
export function newPasswordError(value: string | null | undefined): string | null {
  const password = value ?? ''
  if (password.length < PASSWORD_MIN) return PASSWORD_TOO_SHORT_MESSAGE
  if (password.length > PASSWORD_MAX) return PASSWORD_TOO_LONG_MESSAGE
  return null
}

/** True when a new password meets the length rule. */
export function isValidNewPassword(value: string | null | undefined): boolean {
  return newPasswordError(value) === null
}

/** zod: a new password (8–72 characters). */
export const newPasswordSchema = z.string().min(PASSWORD_MIN, PASSWORD_TOO_SHORT_MESSAGE).max(PASSWORD_MAX, PASSWORD_TOO_LONG_MESSAGE)

/** zod: new password + confirmation (forced change, Profile ▸ Change password). */
export const changePasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, PASSWORD_CONFIRM_MESSAGE),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    error: PASSWORD_MISMATCH_MESSAGE,
  })

export type ChangePasswordValues = z.input<typeof changePasswordSchema>

// ---------------------------------------------------------------------------
// Name and employee ID (the same limits the RPCs enforce)
// ---------------------------------------------------------------------------

export const NAME_MIN = 2
export const NAME_MAX = 80
export const EMPLOYEE_ID_MAX = 40

/** Collapses runs of whitespace and trims (same as the database's clean_name). */
export function cleanName(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** The problem with a full name, or null when it can be saved. */
export function fullNameError(value: string | null | undefined): string | null {
  const name = cleanName(value)
  if (name.length < NAME_MIN) return 'Enter a first and last name.'
  if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
  return null
}

/** The problem with an (optional) employee ID, or null. */
export function employeeIdError(value: string | null | undefined): string | null {
  return (value ?? '').trim().length > EMPLOYEE_ID_MAX ? `Employee ID can be up to ${EMPLOYEE_ID_MAX} characters.` : null
}
