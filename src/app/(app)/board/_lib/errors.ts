// Friendly toast copy for failed actions on the Board and the trade page.
// The API layer already gives every AppError a plain-English `message`; this
// adds a short title per error code (and a little extra explanation for the
// cases firefighters are most likely to hit), so every code reads well.

import type { ToastApi } from '@/components/ui/Toast'
import { toAppError, type AppErrorCode } from '@/lib/errors'

export interface ErrorCopy {
  code: AppErrorCode
  title: string
  description: string
}

/** Titles by code. `null` = use the action's own fallback title. */
const TITLES: Readonly<Record<AppErrorCode, string | null>> = {
  NOT_SIGNED_IN: 'Please sign in again',
  NOT_APPROVED: "Your account can't trade right now",
  NOT_ADMIN: 'Admins only',
  ACK_REQUIRED: 'TeleStaff notice needed',
  INVALID_INPUT: null,
  NOT_FOUND: 'Not found',
  OWN_SHIFT: 'This is your own shift',
  NOT_OPEN: 'No longer open',
  STARTED: 'Too late to change this',
  TOO_FAR_AHEAD: 'Too far ahead',
  RANK_MISMATCH: 'Same rank only',
  OUTSIDE_LIMIT: 'Outside the poster’s limit',
  YOU_WORK_THAT_DAY: 'You’re working that day',
  NOT_YOUR_SHIFT_DAY: 'Not one of your shift days',
  ALREADY_POSTED: 'Already posted',
  ALREADY_COVERING: 'Someone would be double-booked',
  ALREADY_REQUESTED: 'Already waiting for an answer',
  RETURN_DATE_REQUIRED: 'Pick a return date',
  RETURN_DATE_INVALID: 'That return date doesn’t work',
  RETURN_NOT_YOUR_DAY: 'That return date doesn’t work',
  POSTER_WORKS_RETURN_DAY: 'That return date doesn’t work',
  NOT_PARTICIPANT: 'Not part of this trade',
  NO_CANCEL_PENDING: 'Nothing to answer',
  LAST_ADMIN: 'An admin is needed',
  NETWORK: 'You’re offline',
  UNKNOWN: null,
}

/** Extra sentences added after the database's message for some codes. */
const EXTRA: Partial<Record<AppErrorCode, string>> = {
  ALREADY_COVERING: 'ShiftSwap won’t put anyone on two shifts the same day.',
  STARTED: 'Once a shift has started, only an admin can change or void the trade.',
  NOT_OPEN: 'Someone may have changed it a moment ago. The page has been refreshed.',
  NO_CANCEL_PENDING: 'The other member may have just answered or taken it back. The page has been refreshed.',
  ACK_REQUIRED: 'Open the Welcome page to read it, then try again.',
}

/** Per-call wording for some codes (e.g. what ALREADY_COVERING means when confirming vs cancelling). */
export type ErrorExtras = Partial<Record<AppErrorCode, string>>

function withExtra(code: AppErrorCode, message: string, extras?: ErrorExtras): string {
  const extra = extras?.[code] ?? EXTRA[code]
  if (!extra) return message
  // Don't repeat advice the database's message already gives ("Ask an admin …").
  if (code === 'STARTED' && /admin/i.test(message)) return message
  const text = message.trim()
  return `${/[.!?]$/.test(text) ? text : `${text}.`} ${extra}`
}

/**
 * Title + description for a failed action. `fallbackTitle` names the action
 * ("Couldn't send your request") and is used when the code has no better title.
 */
export function describeActionError(error: unknown, fallbackTitle: string, extras?: ErrorExtras): ErrorCopy {
  const e = toAppError(error)
  const title = TITLES[e.code] ?? fallbackTitle
  return { code: e.code, title, description: withExtra(e.code, e.message, extras) }
}

/** Shows a failed action as an error toast; returns the copy (e.g. to branch on `code`). */
export function toastActionError(
  toast: ToastApi,
  error: unknown,
  fallbackTitle: string,
  extras?: ErrorExtras,
): ErrorCopy {
  const copy = describeActionError(error, fallbackTitle, extras)
  toast.show({ tone: 'error', title: copy.title, description: copy.description })
  return copy
}

/** True when an error means the page's data is out of date and should be reloaded. */
export function isStaleDataError(error: unknown): boolean {
  const code = toAppError(error).code
  return (
    code === 'NOT_OPEN' ||
    code === 'NOT_FOUND' ||
    code === 'STARTED' ||
    code === 'ALREADY_REQUESTED' ||
    code === 'NO_CANCEL_PENDING' ||
    code === 'ALREADY_COVERING'
  )
}

/** Errors where an offline snapshot shouldn't stand in for the live data. */
export function isAccountError(error: unknown): boolean {
  const code = toAppError(error).code
  return code === 'NOT_SIGNED_IN' || code === 'NOT_APPROVED'
}
