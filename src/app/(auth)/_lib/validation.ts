// Form rules shared by sign-up (browser + server action), onboarding and the
// password change. They mirror the database checks in complete_onboarding
// (name 2–80 characters, phone 7–20 of digits/+/-/()/space) so members see a
// clear message before anything is sent.

import { z } from 'zod'
import { isRank } from '@/lib/sffd/ranks'
import { isStation } from '@/lib/sffd/stations'
import { isTour } from '@/lib/sffd/tours'

export const NAME_MIN = 2
export const NAME_MAX = 80
export const PASSWORD_MIN = 8
/** Supabase Auth (bcrypt) ignores anything past 72 characters. */
export const PASSWORD_MAX = 72
export const EMPLOYEE_ID_MAX = 40

const PHONE_RE = /^[0-9+() -]{7,20}$/

/** Collapses runs of whitespace and trims (same as the database's clean_name). */
export function cleanName(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** True for a phone number the database accepts that also has at least 7 digits. */
export function isValidPhone(value: string): boolean {
  const phone = value.trim()
  return PHONE_RE.test(phone) && (phone.match(/\d/g)?.length ?? 0) >= 7
}

export const fullNameSchema = z
  .string()
  .transform(cleanName)
  .pipe(
    z
      .string()
      .min(NAME_MIN, 'Enter your first and last name.')
      .max(NAME_MAX, `Keep your name under ${NAME_MAX} characters.`),
  )

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Enter your mobile number.')
  .refine(isValidPhone, 'Enter a phone number with area code, like 415-555-0123.')

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address.')
  .pipe(z.email('Enter a valid email address, like name@example.com.'))

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`)

// ---------------------------------------------------------------------------
// Log in
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})

export type LoginValues = z.input<typeof loginSchema>

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

/** The sign-up fields as the browser form holds them. */
export const signupFormSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    phone: phoneSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Type your password again.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    error: "The two passwords don't match.",
  })

export type SignupFormValues = z.input<typeof signupFormSchema>

/** What the sign-up server action accepts (checked again on the server). */
export const signupRequestSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: newPasswordSchema,
  /** Honeypot: people never see it, so it must come back empty. */
  hp: z.string().max(500).optional().default(''),
  /** Signed "form shown at" token issued with the page. */
  token: z.string().max(200),
})

export type SignupRequest = z.input<typeof signupRequestSchema>

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const onboardingSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  rank: z.string().refine(isRank, 'Choose your rank.'),
  station: z.number().nullable().refine(isStation, 'Choose your station.'),
  /** undefined = not chosen yet; null = "No tour". */
  tour: z
    .number()
    .nullable()
    .optional()
    .refine((tour) => tour === null || isTour(tour), 'Choose your tour, or "No tour" if you aren\'t on one.'),
  employeeId: z
    .string()
    .trim()
    .max(EMPLOYEE_ID_MAX, `Employee ID can be up to ${EMPLOYEE_ID_MAX} characters.`),
})

export type OnboardingFormValues = z.input<typeof onboardingSchema>

// ---------------------------------------------------------------------------
// New password (forced or voluntary change)
// ---------------------------------------------------------------------------

export const changePasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Type your new password again.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    error: "The two passwords don't match.",
  })

export type ChangePasswordValues = z.input<typeof changePasswordSchema>
