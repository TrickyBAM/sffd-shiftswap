// The log-in, sign-up and onboarding forms (browser + the sign-up server
// action). The field rules themselves — name, phone, password, employee ID —
// come from '@/lib/validation', the one copy every screen uses (CC-6), so a
// phone number accepted here is accepted everywhere else, and the other way
// round. They mirror the database checks in complete_onboarding, so members
// see a clear message before anything is sent.

import { z } from 'zod'
import { isRank } from '@/lib/sffd/ranks'
import { isStation } from '@/lib/sffd/stations'
import { isTour } from '@/lib/sffd/tours'
import {
  cleanName,
  employeeIdError,
  fullNameError,
  newPasswordSchema,
  PASSWORD_MISMATCH_MESSAGE,
  phoneSchema,
} from '@/lib/validation'

/** zod check from one of the shared validators (message, or null when fine). */
function checkWith(validate: (value: string) => string | null) {
  return (value: string, ctx: z.RefinementCtx) => {
    const message = validate(value)
    if (message) ctx.addIssue({ code: 'custom', message })
  }
}

/** A full name: whitespace collapsed, 2–80 characters. */
export const fullNameSchema = z.string().transform(cleanName).superRefine(checkWith(fullNameError))

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address.')
  .pipe(z.email('Enter a valid email address, like name@example.com.'))

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
    error: PASSWORD_MISMATCH_MESSAGE,
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
  employeeId: z.string().trim().superRefine(checkWith(employeeIdError)),
})

export type OnboardingFormValues = z.input<typeof onboardingSchema>
