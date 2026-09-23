// The signed-in member: profile row, onboarding, settings, stats and balances
// (ARCHITECTURE §6.3 "Onboarding & profile").

import type {
  LedgerRow,
  MemberCard,
  MyStats,
  NotifyScope,
  OnboardingResult,
  Profile,
  Rank,
} from '@/lib/types/database'
import { assertUuid, blankToNull, callRpc, resolveUserId, runMaybe, type Sb } from './core'

/**
 * My own profiles row, or null when the signed-in user has none (it is
 * created by a trigger at sign-up, so null means a broken account). Pass
 * `userId` when known to skip a session lookup. Throws AppError on any
 * failure, so a network or database error is never mistaken for "no profile".
 */
export async function getMyProfile(sb: Sb, userId?: string | null): Promise<Profile | null> {
  const id = await resolveUserId(sb, userId)
  return runMaybe<Profile>(sb.from('profiles').select('*').eq('id', id).maybeSingle())
}

export interface OnboardingInput {
  fullName: string
  phone: string
  rank: Rank
  station: number
  /** 1–31, or null for "No tour". */
  tour: number | null
  employeeId?: string | null
}

/**
 * Saves my profile at first sign-in (or while pending) and runs roster
 * matching (complete_onboarding). Returns approved/pending with a friendly
 * message; admins are notified either way.
 */
export async function completeOnboarding(sb: Sb, input: OnboardingInput): Promise<OnboardingResult> {
  return callRpc(
    sb,
    'complete_onboarding',
    {
      p_full_name: input.fullName,
      p_phone: input.phone,
      p_rank: input.rank,
      p_station: input.station,
      p_tour: input.tour ?? null,
      p_employee_id: blankToNull(input.employeeId),
    },
    { flush: true },
  )
}

/** Records the one-time TeleStaff acknowledgment (acknowledge_telestaff). */
export async function acknowledgeTelestaff(sb: Sb): Promise<void> {
  await callRpc(sb, 'acknowledge_telestaff', {})
}

export interface UpdateMyProfileInput {
  phone: string
  station: number
  /** 1–31, or null for "No tour". */
  tour: number | null
  notifyScope: NotifyScope
}

/**
 * Updates my phone, station, tour and new-shift alert scope
 * (update_my_profile). Name, rank and employee ID are admin-only.
 */
export async function updateMyProfile(sb: Sb, input: UpdateMyProfileInput): Promise<void> {
  await callRpc(sb, 'update_my_profile', {
    p_phone: input.phone,
    p_station: input.station,
    p_tour: input.tour ?? null,
    p_notify_scope: input.notifyScope,
  })
}

/** Clears the forced-password-change flag after I set a new password. */
export async function clearMustChangePassword(sb: Sb): Promise<void> {
  await callRpc(sb, 'clear_must_change_password', {})
}

/** Issues a new calendar feed token (the old subscription URL stops working). */
export async function regenerateCalendarToken(sb: Sb): Promise<string> {
  return callRpc(sb, 'regenerate_calendar_token', {})
}

/** My Profile-page numbers: posted, covered, given, outstanding, balance, trust score, per type. */
export async function getMyStats(sb: Sb): Promise<MyStats> {
  return callRpc(sb, 'my_stats', {})
}

/** My balance with each trade partner, per shift type (my_ledger) — the Balances tab. */
export async function getMyLedger(sb: Sb): Promise<LedgerRow[]> {
  const rows = await callRpc(sb, 'my_ledger', {})
  return Array.isArray(rows) ? rows : []
}

/**
 * Another approved member's public summary (member_card): name, rank,
 * station, trust score, covered/given. No contact details.
 */
export async function getMemberCard(sb: Sb, userId: string): Promise<MemberCard> {
  return callRpc(sb, 'member_card', { p_user_id: assertUuid(userId, 'member') })
}
