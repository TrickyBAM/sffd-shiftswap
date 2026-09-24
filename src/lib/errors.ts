// Member-facing errors (ARCHITECTURE §6, §6.6, §7.2).
//
// Everything the API layer (src/lib/api) throws is an AppError: a `code` the UI
// can branch on and a `message` that is always plain English, safe to show a
// firefighter as-is. toAppError() turns whatever Supabase, PostgREST, fetch or
// the auth client produced into one:
//
//   - RPC rule failures (`raise … errcode 'P0001', hint '<CODE>'`) keep the
//     database's friendly message and use the hint as the code.
//   - No connection, timeouts, a paused/unreachable backend (HTML error pages,
//     gateway errors, "Unexpected token '<'" JSON parse failures) become
//     code 'NETWORK' with NETWORK_MESSAGE.
//   - Everything else is mapped from Postgres/PostgREST/auth codes to a
//     friendly default. Raw technical text ('{}', stack traces, PGRST codes,
//     SQL) is never used as the message; it is kept in `details` for logs.

import { isMissingEnvError } from '@/lib/env'
import { ERROR_HINTS, isErrorHint, type ErrorHint } from '@/lib/types/database'

export type { ErrorHint }

/** What an AppError's `code` can be: an RPC hint (§6.6), 'NETWORK' or 'UNKNOWN'. */
export type AppErrorCode = ErrorHint | 'NETWORK' | 'UNKNOWN'

/** Every AppErrorCode, for validation. */
export const APP_ERROR_CODES: readonly AppErrorCode[] = Object.freeze([...ERROR_HINTS, 'NETWORK', 'UNKNOWN'])

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return value === 'NETWORK' || value === 'UNKNOWN' || isErrorHint(value)
}

/** Shown whenever ShiftSwap can't be reached. */
export const NETWORK_MESSAGE = "Can't reach ShiftSwap right now. Check your connection and try again."

/** Shown when nothing more specific is known. */
export const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

// Friendly defaults, used when an error carries a code but no usable message.
const DEFAULT_MESSAGES: Readonly<Record<AppErrorCode, string>> = Object.freeze({
  NOT_SIGNED_IN: 'Please sign in again.',
  NOT_APPROVED: "Your account isn't approved for trading right now.",
  NOT_ADMIN: 'Only admins can do that.',
  ACK_REQUIRED: 'Please read and acknowledge the TeleStaff notice first.',
  INVALID_INPUT: "Some of the details aren't valid. Check them and try again.",
  NOT_FOUND: "We couldn't find that. It may have been cancelled or removed.",
  OWN_SHIFT: 'This is your own shift.',
  NOT_OPEN: 'This shift is no longer open.',
  STARTED: 'This shift has already started.',
  TOO_FAR_AHEAD: 'That date is too far ahead. Shifts can be traded up to 180 days out.',
  RANK_MISMATCH: 'Trades are same rank only.',
  OUTSIDE_LIMIT: 'The poster limited this shift to members closer to their station.',
  YOU_WORK_THAT_DAY: "You're working that day.",
  NOT_YOUR_SHIFT_DAY: "That isn't one of your shift days.",
  ALREADY_POSTED: 'You already posted or traded that shift.',
  ALREADY_COVERING: 'Someone in this trade is already covering a shift that day.',
  ALREADY_REQUESTED: 'That request is already waiting for an answer.',
  RETURN_DATE_REQUIRED: 'This is a SwapMatch. Pick a return date.',
  RETURN_DATE_INVALID: 'Pick one of the return dates the poster offered.',
  RETURN_NOT_YOUR_DAY: "That return date isn't one of your own shifts to give.",
  POSTER_WORKS_RETURN_DAY: 'The poster is working on that return date.',
  NOT_PARTICIPANT: 'Only the members in this trade can do that.',
  NO_CANCEL_PENDING: "There's no cancel request waiting on this trade.",
  LAST_ADMIN: 'ShiftSwap needs at least one admin. Make someone else an admin first.',
  NETWORK: NETWORK_MESSAGE,
  UNKNOWN: GENERIC_MESSAGE,
})

/** The default friendly message for a code (unknown codes get GENERIC_MESSAGE). */
export function friendlyMessage(code: AppErrorCode | string | null | undefined): string {
  return (isAppErrorCode(code) && DEFAULT_MESSAGES[code]) || GENERIC_MESSAGE
}

// Messages for errors that are not RPC hints.
const MESSAGES = Object.freeze({
  sessionExpired: 'Your session has expired. Please sign in again.',
  noPermission: "You don't have permission to do that.",
  notSetUp: "This part of ShiftSwap isn't set up yet. Please try again later, or tell an admin.",
  duplicate: 'That already exists. Refresh and try again.',
  missingReference: 'Something this refers to no longer exists. Refresh and try again.',
  timeout: 'ShiftSwap took too long to answer. Please try again.',
  conflict: 'Someone else changed this at the same moment. Please try again.',
  rateLimited: 'Too many attempts. Wait a few minutes and try again.',
  wrongPassword: "That email and password don't match.",
  accountExists: 'An account with that email already exists. Try signing in instead.',
  weakPassword: 'Choose a stronger password.',
  samePassword: 'Your new password must be different from your current one.',
  reauthNeeded: 'For your security, sign out, sign back in, and then change your password.',
  invalidEmail: 'Enter a valid email address.',
  banned: 'This account is blocked. Contact an admin if you think this is a mistake.',
  signupClosed: 'New sign-ups are closed right now. Contact an admin.',
})

export interface AppErrorOptions {
  /** The original error, for logging. */
  cause?: unknown
  /** HTTP status of the failed response, when known (0 = no response). */
  status?: number | null
  /** Technical detail for logs. Never shown to members. */
  details?: string | null
}

/**
 * An error whose message is safe to show a member. Throw it (or let the API
 * layer throw it) and show `message`; branch on `code` when the UI needs to,
 * e.g. redirect on NOT_SIGNED_IN or offer "Try again" on NETWORK.
 */
export class AppError extends Error {
  readonly code: AppErrorCode
  /** HTTP status of the failed response, when known (0 = no response). */
  readonly status: number | null
  /** Technical detail for logs (codes, raw messages). Never shown to members. */
  readonly details: string | null

  constructor(code: AppErrorCode, message?: string | null, options: AppErrorOptions = {}) {
    super(message || friendlyMessage(code), options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = options.status ?? null
    this.details = options.details ?? null
  }

  /** True for connection problems (retrying may help). */
  get isNetwork(): boolean {
    return this.code === 'NETWORK'
  }

  /** Plain object form, e.g. to return from a Server Action. toAppError() reads it back. */
  toJSON(): { name: 'AppError'; code: AppErrorCode; message: string } {
    return { name: 'AppError', code: this.code, message: this.message }
  }
}

/** True for an AppError (also one from another bundle/module instance). */
export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true
  const e = error as { name?: unknown; code?: unknown; message?: unknown } | null
  return (
    typeof e === 'object' &&
    e !== null &&
    e.name === 'AppError' &&
    isAppErrorCode(e.code) &&
    typeof e.message === 'string' &&
    error instanceof Error
  )
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** The fields we look at on any error-like value. */
interface ErrorInfo {
  name: string
  message: string
  code: string
  hint: string
  details: string
  status: number | null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readInfo(error: unknown): ErrorInfo {
  if (typeof error === 'string') {
    return { name: '', message: error, code: '', hint: '', details: '', status: null }
  }
  if (typeof error !== 'object' || error === null) {
    return { name: '', message: '', code: '', hint: '', details: '', status: null }
  }
  const e = error as Record<string, unknown>
  const status = typeof e.status === 'number' && Number.isFinite(e.status) ? e.status : null
  const code = typeof e.code === 'number' ? String(e.code) : str(e.code)
  return {
    name: str(e.name),
    message: str(e.message),
    code,
    hint: str(e.hint),
    details: str(e.details),
    status,
  }
}

// fetch() failures across browsers/runtimes, and Node socket errors.
const NETWORK_MESSAGE_RE =
  /failed to fetch|fetch failed|networkerror|network ?error|network request failed|load failed|network connection was lost|internet connection appears to be offline|err_internet_disconnected|err_network|econnrefused|econnreset|enotfound|etimedout|eai_again|enetunreach|ehostunreach|socket hang up|und_err_|terminated/i

// Response bodies that were not JSON: an HTML error/maintenance page, or the
// JSON parse error it causes.
const HTML_RE = /^\s*<(?:!doctype|html|head|body|\?xml|title|h1|center)\b|<\/?(?:html|body|head|title)\b/i
const JSON_PARSE_RE =
  /unexpected token|is not valid json|json\.parse|unexpected end of json|unexpected character|unexpected non-whitespace|jsonparse|invalid json/i

// Gateway and CDN errors in front of Supabase (paused project, outage).
function isGatewayStatus(status: number | null): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504 || (status !== null && status >= 520 && status <= 599)
}

// Postgres SQLSTATE classes that mean "the database can't serve requests right
// now": connection exceptions (08), insufficient resources (53), operator
// intervention / shutdown (57P01–57P03).
const PG_UNAVAILABLE_RE = /^(?:08[0-9A-Z]{3}|53[0-9A-Z]{3}|57P0[1-3])$/
// PostgREST can't reach or pool the database.
const PGRST_UNAVAILABLE = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])

// A Postgres SQLSTATE ('P0001', '23505') or PostgREST code ('PGRST116').
const SERVER_CODE_RE = /^(?:PGRST[0-9A-Z]+|[0-9A-Z]{5})$/

function isNetworkFailure(info: ErrorInfo, status: number | null): boolean {
  if (PGRST_UNAVAILABLE.has(info.code) || PG_UNAVAILABLE_RE.test(info.code)) return true
  // Any other Postgres/PostgREST error body means the backend answered.
  if (SERVER_CODE_RE.test(info.code)) return false
  if (info.name === 'AuthRetryableFetchError') return true
  if (info.name === 'AbortError' || info.name === 'TimeoutError') return true
  if (isGatewayStatus(status)) return true
  if (NETWORK_MESSAGE_RE.test(info.message)) return true
  if (HTML_RE.test(`${info.message}\n${info.details}`)) return true
  if (info.name === 'SyntaxError' || JSON_PARSE_RE.test(info.message)) return true
  return false
}

// Auth API error codes (supabase auth-js `AuthError.code`).
const AUTH_CODES: Readonly<Record<string, [AppErrorCode, string]>> = Object.freeze({
  invalid_credentials: ['INVALID_INPUT', MESSAGES.wrongPassword],
  user_already_exists: ['INVALID_INPUT', MESSAGES.accountExists],
  email_exists: ['INVALID_INPUT', MESSAGES.accountExists],
  weak_password: ['INVALID_INPUT', MESSAGES.weakPassword],
  same_password: ['INVALID_INPUT', MESSAGES.samePassword],
  reauthentication_needed: ['INVALID_INPUT', MESSAGES.reauthNeeded],
  email_address_invalid: ['INVALID_INPUT', MESSAGES.invalidEmail],
  validation_failed: ['INVALID_INPUT', DEFAULT_MESSAGES.INVALID_INPUT],
  user_banned: ['NOT_APPROVED', MESSAGES.banned],
  signup_disabled: ['UNKNOWN', MESSAGES.signupClosed],
  over_request_rate_limit: ['UNKNOWN', MESSAGES.rateLimited],
  over_email_send_rate_limit: ['UNKNOWN', MESSAGES.rateLimited],
  over_sms_send_rate_limit: ['UNKNOWN', MESSAGES.rateLimited],
  request_timeout: ['UNKNOWN', MESSAGES.timeout],
  hook_timeout: ['UNKNOWN', MESSAGES.timeout],
  hook_timeout_after_retry: ['UNKNOWN', MESSAGES.timeout],
  session_not_found: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  session_expired: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  refresh_token_not_found: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  refresh_token_already_used: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  bad_jwt: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  invalid_jwt: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  no_authorization: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  user_not_found: ['NOT_SIGNED_IN', MESSAGES.sessionExpired],
  not_admin: ['NOT_ADMIN', DEFAULT_MESSAGES.NOT_ADMIN],
})

// Auth error classes without a code that mean "signed out".
const AUTH_SIGNED_OUT_NAMES = new Set([
  'AuthSessionMissingError',
  'AuthInvalidJwtError',
  'AuthInvalidTokenResponseError',
  'AuthRefreshDiscardedError',
])

/** Maps a Postgres SQLSTATE or PostgREST code to [code, message], or null. */
function fromServerCode(code: string, status: number | null): [AppErrorCode, string] | null {
  switch (code) {
    // PostgREST JWT problems: missing, invalid or expired session token.
    case 'PGRST301':
    case 'PGRST302':
    case 'PGRST303':
      return ['NOT_SIGNED_IN', MESSAGES.sessionExpired]
    // .single() found no row.
    case 'PGRST116':
      return ['NOT_FOUND', DEFAULT_MESSAGES.NOT_FOUND]
    // Function, table or column missing: migrations not applied yet.
    case 'PGRST202':
    case 'PGRST204':
    case 'PGRST205':
    case '42883':
    case '42P01':
    case '42703':
    case '3F000':
      return ['UNKNOWN', MESSAGES.notSetUp]
    // Permission denied / row-level security violation.
    case '42501':
      return status === 401 ? ['NOT_SIGNED_IN', MESSAGES.sessionExpired] : ['UNKNOWN', MESSAGES.noPermission]
    case '23505':
      return ['INVALID_INPUT', MESSAGES.duplicate]
    case '23503':
      return ['INVALID_INPUT', MESSAGES.missingReference]
    case '57014':
      return ['UNKNOWN', MESSAGES.timeout]
    case '40001':
    case '40P01':
      return ['UNKNOWN', MESSAGES.conflict]
  }
  // Data exceptions (bad date, uuid, number, too long…) and integrity
  // constraint violations (check, not-null): the input was rejected.
  if (/^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3})$/.test(code)) return ['INVALID_INPUT', DEFAULT_MESSAGES.INVALID_INPUT]
  return null
}

/**
 * The message itself, if it reads like a sentence meant for people: our RPCs
 * and serialized AppErrors. Rejects JSON, HTML, stack-trace-like and
 * over-long text.
 */
function displayable(message: string): string | null {
  const text = message.trim()
  if (!text || text.length > 500) return null
  if (/^[[{<]/.test(text) || text === '[object Object]') return null
  if (/^[A-Za-z]*Error\b|^PGRST|\n\s+at |\bat [\w.$<>]+ \(|unexpected token/i.test(text)) return null
  return text
}

function technicalDetails(info: ErrorInfo, status: number | null): string | null {
  const parts = [
    info.name && info.name !== 'Error' ? info.name : '',
    info.code ? `[${info.code}]` : '',
    status !== null ? `(HTTP ${status})` : '',
    info.message,
    info.details ? `details: ${info.details}` : '',
    info.hint ? `hint: ${info.hint}` : '',
  ].filter(Boolean)
  if (!parts.length) return null
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text
}

export interface ToAppErrorContext {
  /** HTTP status of the response the error came from (supabase-js `status`). */
  status?: number | null
}

/**
 * Converts anything thrown or returned as `error` by Supabase, PostgREST,
 * fetch or auth into an AppError with a member-friendly message. Never throws.
 */
export function toAppError(error: unknown, context: ToAppErrorContext = {}): AppError {
  if (error instanceof AppError) return error
  if (isMissingEnvError(error)) {
    // A configuration problem; its message says exactly what to set (§7.4).
    return new AppError('UNKNOWN', (error as Error).message, { cause: error })
  }

  const info = readInfo(error)
  const status = context.status ?? info.status
  const options = (): AppErrorOptions => ({ cause: error, status, details: technicalDetails(info, status) })

  // 1. A rule failure raised by one of our RPCs: keep its message.
  if (isErrorHint(info.hint)) {
    return new AppError(info.hint, displayable(info.message) ?? friendlyMessage(info.hint), options())
  }

  // 2. An AppError that lost its prototype (serialized, or from another bundle).
  if (isAppErrorCode(info.code)) {
    const message = info.code === 'NETWORK' ? NETWORK_MESSAGE : displayable(info.message)
    return new AppError(info.code, message ?? friendlyMessage(info.code), options())
  }

  // 3. Couldn't reach the backend, or it answered with something that isn't ours.
  if (isNetworkFailure(info, status)) return new AppError('NETWORK', NETWORK_MESSAGE, options())

  // 4. Auth client errors.
  const auth = AUTH_CODES[info.code]
  if (auth) return new AppError(auth[0], auth[1], options())
  if (AUTH_SIGNED_OUT_NAMES.has(info.name)) return new AppError('NOT_SIGNED_IN', MESSAGES.sessionExpired, options())

  // 5. Postgres / PostgREST codes.
  const server = fromServerCode(info.code, status)
  if (server) return new AppError(server[0], server[1], options())

  // 6. HTTP status alone.
  if (status === 401) return new AppError('NOT_SIGNED_IN', MESSAGES.sessionExpired, options())
  if (status === 403) return new AppError('UNKNOWN', MESSAGES.noPermission, options())
  if (status === 429) return new AppError('UNKNOWN', MESSAGES.rateLimited, options())
  if (status === 408) return new AppError('UNKNOWN', MESSAGES.timeout, options())

  // 7. A raise from our SQL without a known hint: the message is still ours.
  if (info.code === 'P0001') {
    return new AppError('UNKNOWN', displayable(info.message) ?? GENERIC_MESSAGE, options())
  }

  return new AppError('UNKNOWN', GENERIC_MESSAGE, options())
}

/** The friendly message for any error (shorthand for toAppError(error).message). */
export function errorMessage(error: unknown): string {
  return toAppError(error).message
}

/** True when the error is a connection problem (offline, backend unreachable/paused). */
export function isNetworkError(error: unknown): boolean {
  return toAppError(error).code === 'NETWORK'
}
