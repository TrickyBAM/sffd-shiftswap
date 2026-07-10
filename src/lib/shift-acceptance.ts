export const ATOMIC_ACCEPT_RPC = 'accept_shift_with_match'

type ErrorLike = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

function errorText(error: ErrorLike) {
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

/**
 * The web app is deployed before the database migration on purpose. During
 * that short window PostgREST reports that the new RPC is missing, and only
 * that condition is safe to send through the existing accept flow.
 */
export function shouldUseLegacyAccept(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const candidate = error as ErrorLike
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const text = errorText(candidate)
  const namesAtomicRpc = text.includes(ATOMIC_ACCEPT_RPC)

  return namesAtomicRpc && (code === 'PGRST202' || code === '42883')
}

export function getAcceptanceErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const message = (error as ErrorLike).message
    if (typeof message === 'string' && message) return message
  }
  return 'Failed to accept shift'
}
