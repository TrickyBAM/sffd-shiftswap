// Sign-up rate limits (SEC-2, SEC-5), checked by the sign-up server action
// with public.signup_rate_check. Kept out of actions.ts: a 'use server' file
// may only export async functions.

/** Sign-up tries per email address per window. */
export const EMAIL_LIMIT = 3

/**
 * Sign-ups per network (a public IPv4 address, or an IPv6 /64) per window:
 * enough for a whole crew signing up together on station or city Wi-Fi,
 * where everyone shares one public address.
 */
export const NETWORK_LIMIT = 30

/** Both limits count tries within the last hour. */
export const LIMIT_WINDOW_MINUTES = 60

// What a blocked member sees. Neither message sends them to an admin: admins
// have no way to lift the limit. Waiting always works; for the network limit,
// so does switching to cellular data (a different network).

export const EMAIL_LIMIT_MESSAGE =
  'Too many sign-up tries with this email in the last hour. Try again later. If you already made an account, log in instead.'

export const NETWORK_LIMIT_MESSAGE =
  'Too many sign-ups from this network in the last hour. Try again later, or turn off Wi-Fi and use cellular data.'
