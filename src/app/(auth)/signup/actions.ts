'use server'

// Sign-up server action (ARCHITECTURE §1 "Email: none at launch", §6.1
// private.signup_attempts, §9 signup_rate_check).
//
// Creates an already-confirmed account with the service-role client. Filters,
// cheapest first: input validation, honeypot, "filled in under 3 seconds",
// then two rate limits (SEC-2, SEC-5):
//   - per email address: EMAIL_LIMIT tries an hour, so nobody can keep
//     probing one address (and one person retrying doesn't use up the
//     network's allowance);
//   - per network: NETWORK_LIMIT sign-ups an hour, high enough for a whole
//     crew signing up together on station Wi-Fi (one public IP). IPv6
//     clients count by their /64 network.
// Every allowed try counts, including ones Supabase then refuses.
//
// "An account with this email already exists" is kept on purpose: with no
// sign-up emails there is no other way to tell a member they already signed
// up, and the per-email limit caps how often any one address can be checked.
//
// Never throws: every outcome is a typed SignupResult with a friendly
// message. Never logs the password, the secret key, the IP or the email.

import { headers } from 'next/headers'
import { signupRateCheck } from '@/lib/api'
import { getServerEnv } from '@/lib/env'
import { toAppError } from '@/lib/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { signupRequestSchema } from '../_lib/validation'
import { checkFormToken, clientIpFrom, hashClientIp, hashEmailKey } from './_lib/guard'
import {
  EMAIL_LIMIT,
  EMAIL_LIMIT_MESSAGE,
  LIMIT_WINDOW_MINUTES,
  NETWORK_LIMIT,
  NETWORK_LIMIT_MESSAGE,
} from './_lib/limits'
import { isSignupField, type SignupResult } from './_lib/result'

const GENERIC_FAILURE = "We couldn't create your account. Refresh the page and try again."

export async function signUp(input: unknown): Promise<SignupResult> {
  try {
    return await createAccount(input)
  } catch (err) {
    const error = toAppError(err)
    console.error('[signup] failed:', error.code, error.details ?? '')
    return { ok: false, message: error.message }
  }
}

async function createAccount(input: unknown): Promise<SignupResult> {
  const parsed = signupRequestSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0]
    return {
      ok: false,
      message: issue?.message ?? 'Check your details and try again.',
      field: isSignupField(field) ? field : undefined,
    }
  }
  const { fullName, email, phone, password, hp, token } = parsed.data

  // Honeypot: a field people never see. Anything in it means a bot.
  if (hp.trim() !== '') return { ok: false, message: GENERIC_FAILURE, retry: 'refresh' }

  const { supabaseSecretKey } = getServerEnv()

  switch (checkFormToken(token, supabaseSecretKey)) {
    case 'too-fast':
      return { ok: false, message: 'That was quick! Check your details, then tap Create account again.' }
    case 'expired':
      return {
        ok: false,
        message: 'This page has been open a long time. Refresh it and try again.',
        retry: 'refresh',
      }
    case 'invalid':
      return { ok: false, message: GENERIC_FAILURE, retry: 'refresh' }
    case 'ok':
      break
  }

  const admin = createAdminClient()
  const perHour = { windowMinutes: LIMIT_WINDOW_MINUTES }

  // The email first: someone retrying one address stops here, without using
  // up the network's allowance that the rest of the crew shares.
  const emailKey = hashEmailKey(email, supabaseSecretKey)
  if (!(await signupRateCheck(admin, emailKey, { ...perHour, max: EMAIL_LIMIT }))) {
    return { ok: false, message: EMAIL_LIMIT_MESSAGE }
  }

  const headerList = await headers()
  const networkKey = hashClientIp(
    clientIpFrom((name) => headerList.get(name)),
    supabaseSecretKey,
  )
  if (!(await signupRateCheck(admin, networkKey, { ...perHour, max: NETWORK_LIMIT }))) {
    return { ok: false, message: NETWORK_LIMIT_MESSAGE }
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone },
  })
  if (error) return createUserFailure(error)
  return { ok: true }
}

function createUserFailure(error: unknown): SignupResult {
  const e = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown
    message?: unknown
    reasons?: unknown
  }
  const code = typeof e.code === 'string' ? e.code : ''
  const message = typeof e.message === 'string' ? e.message : ''

  if (
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    /already (?:been )?registered|already exists/i.test(message)
  ) {
    return {
      ok: false,
      field: 'email',
      code: 'account-exists',
      message: 'An account with this email already exists — try logging in.',
    }
  }
  if (code === 'weak_password') {
    const reasons = Array.isArray(e.reasons) ? e.reasons : []
    return {
      ok: false,
      field: 'password',
      message: reasons.includes('pwned')
        ? 'That password has shown up in a data breach somewhere. Choose a different one.'
        : 'Choose a stronger password: longer, with a mix of letters and numbers.',
    }
  }
  if (code === 'email_address_invalid') {
    return { ok: false, field: 'email', message: 'Enter a valid email address.' }
  }

  const appError = toAppError(error)
  console.error('[signup] createUser failed:', appError.code, appError.details ?? '')
  return { ok: false, message: appError.message }
}
