// Removing a member's account at their request (CC-4). The database part is
// admin_remove_member (migration 0011): the account is closed and suspended,
// and their phone, employee ID, alerts and roster link are erased. The login
// is closed separately with the service key (removeMember in ../../actions.ts):
// the sign-in email is swapped for a placeholder (which frees their real email
// to sign up again and, through the auth trigger, erases it from the profile
// too) and the login is banned. Plain module: used by the server action, the
// member sheet and tests.

import type { Profile, RemoveMemberResult } from '@/lib/types/database'
import { plural } from '@/lib/format'

/** Domain of the placeholder sign-in email (.invalid never receives mail, RFC 2606). */
export const REMOVED_EMAIL_DOMAIN = 'shiftswap.invalid'

/** How long a removed login stays banned: 100 years, i.e. for good. */
export const REMOVED_BAN_DURATION = '876000h'

/** The placeholder sign-in email for a removed account: removed+<id>@shiftswap.invalid. */
export function removedLoginEmail(memberId: string): string {
  return `removed+${memberId.toLowerCase()}@${REMOVED_EMAIL_DOMAIN}`
}

/** True when the email is a removed account's placeholder (so the real one is gone). */
export function isRemovedLoginEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(`@${REMOVED_EMAIL_DOMAIN}`)
}

/**
 * What happened to the login:
 *   closed   sign-in email erased and the login banned (the normal case)
 *   blocked  the login is banned, but the sign-in email couldn't be erased
 *   open     neither worked (the account is still closed inside ShiftSwap)
 */
export type LoginClosure = 'closed' | 'blocked' | 'open'

/** A removed account whose sign-in email is still on file (the login step didn't finish). */
export function loginStillOnFile(member: Pick<Profile, 'removed_at' | 'email'>): boolean {
  return Boolean(member.removed_at) && !isRemovedLoginEmail(member.email)
}

/** The success toast after a removal: what came off the board and what's left to do. */
export function removalSummary(board: RemoveMemberResult | null): string {
  if (!board) return 'Their login is closed.'
  const parts: string[] = []
  if (board.posts_cancelled > 0) parts.push(`${plural(board.posts_cancelled, 'open post')} taken down`)
  if (board.requests_closed > 0) parts.push(`${plural(board.requests_closed, 'request')} closed`)
  const done = parts.length ? `${parts.join(', ')}. ` : ''
  const upcoming =
    board.upcoming_trades > 0
      ? `They still have ${plural(board.upcoming_trades, 'confirmed trade')} coming up. Void ${
          board.upcoming_trades === 1 ? 'it' : 'them'
        } in Trades if ${board.upcoming_trades === 1 ? "it won't" : "they won't"} happen.`
      : ''
  return `${done}${upcoming}`.trim() || 'Nothing of theirs was on the board.'
}

/** A warning when the login step didn't fully work, or null. */
export function loginClosureWarning(login: LoginClosure): string | null {
  if (login === 'closed') return null
  if (login === 'blocked') {
    return "Their login is blocked, but their sign-in email couldn't be erased, so they can't sign up again with it. Try Finish removal on their page later."
  }
  return "Their account is closed in ShiftSwap, but their login couldn't be blocked or their email erased. Try Finish removal on their page."
}
