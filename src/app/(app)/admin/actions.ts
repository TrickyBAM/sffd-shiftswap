'use server'

// Admin server actions. Only async functions may be exported from this file.

import { adminRemoveMember, getMember, getMyProfile, isUuid, markMustChangePassword, type Sb } from '@/lib/api'
import { AppError, toAppError, type AppErrorCode } from '@/lib/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { Profile, RemoveMemberResult } from '@/lib/types/database'
import { generateTempPassword } from './_lib/temp-password'
import { REMOVED_BAN_DURATION, removedLoginEmail, type LoginClosure } from './members/_lib/remove'

export type ResetPasswordResult =
  | {
      ok: true
      /** The temporary password. Shown to the admin once; never stored or logged. */
      password: string
      /** False when the password was set but the "change it at next sign-in" flag couldn't be saved. */
      forcedChange: boolean
    }
  | { ok: false; code: AppErrorCode; message: string }

type Failure = { ok: false; code: AppErrorCode; message: string }

function failure(err: unknown, what: string): Failure {
  const error = toAppError(err)
  if (error.code === 'UNKNOWN' || error.code === 'NETWORK') {
    console.error(`${what} failed`, error.details ?? error.message)
  }
  return { ok: false, code: error.code, message: error.message }
}

/**
 * The signed-in admin and the member they are acting on, read with the
 * admin's own session. Throws AppError when the caller isn't an approved
 * admin, acts on themselves, or the member doesn't exist.
 */
async function adminAndMember(memberId: string, selfMessage: string): Promise<{ sb: Sb; member: Profile }> {
  if (!isUuid(memberId)) throw new AppError('INVALID_INPUT', "That member link isn't valid.")
  const sb = await createClient()
  const me = await getMyProfile(sb)
  if (!me || me.role !== 'admin' || me.status !== 'approved') throw new AppError('NOT_ADMIN')
  if (me.id === memberId) throw new AppError('INVALID_INPUT', selfMessage)
  const member = await getMember(sb, memberId)
  if (!member) throw new AppError('NOT_FOUND', "That member wasn't found.")
  return { sb, member }
}

/**
 * Resets a member's password to a readable temporary one (ARCHITECTURE §1:
 * no email; admins reset forgotten passwords). The caller must be an approved
 * admin, checked here from their own profile with their own session. The new
 * password is set with the service key, then admin_mark_must_change_password
 * runs as the admin (audited) so the member must pick a new one at sign-in.
 */
export async function resetMemberPassword(memberId: string): Promise<ResetPasswordResult> {
  try {
    const { sb, member } = await adminAndMember(
      memberId,
      'To change your own password, use Change password on your Profile page.',
    )
    if (member.removed_at) {
      throw new AppError('INVALID_INPUT', "This account was removed, so there's no password to reset.")
    }

    const password = generateTempPassword()
    const { error } = await createAdminClient().auth.admin.updateUserById(memberId, { password })
    if (error) {
      const code = (error as { code?: unknown }).code
      if (code === 'user_not_found' || error.status === 404) {
        throw new AppError('NOT_FOUND', "We couldn't find that member's login.", { cause: error })
      }
      throw toAppError(error)
    }

    let forcedChange = true
    try {
      await markMustChangePassword(sb, memberId)
    } catch (err) {
      // The password is already changed, so the admin still needs to see it.
      forcedChange = false
      console.error('resetMemberPassword: could not set must_change_password', toAppError(err).details)
    }
    return { ok: true, password, forcedChange }
  } catch (err) {
    return failure(err, 'resetMemberPassword')
  }
}

export type RemoveMemberActionResult =
  | {
      ok: true
      /**
       * What admin_remove_member took off the board; null when the account
       * had already been removed and only the login was closed now.
       */
      board: RemoveMemberResult | null
      /** What happened to their login (see LoginClosure). */
      login: LoginClosure
    }
  | Failure

/**
 * Blocks a removed member's login with the service key: the sign-in email
 * becomes removed+<id>@shiftswap.invalid (their real email is free to sign up
 * again, and the auth trigger copies the placeholder over the profile's
 * email), the login is banned for good, and the phone number the sign-up
 * page saved in the login's metadata is deleted. Falls back to the ban alone
 * if the email change is refused. Never throws.
 */
async function closeLogin(memberId: string): Promise<LoginClosure> {
  const log = (step: string, err: unknown) => {
    const error = toAppError(err)
    console.error(`removeMember: could not ${step}`, error.details ?? error.message)
  }
  let admin: ReturnType<typeof createAdminClient>['auth']['admin']
  try {
    admin = createAdminClient().auth.admin
  } catch (err) {
    log('create the service client', err)
    return 'open'
  }
  const block = { ban_duration: REMOVED_BAN_DURATION, user_metadata: { phone: null } }
  try {
    const { error } = await admin.updateUserById(memberId, { ...block, email: removedLoginEmail(memberId) })
    if (!error) return 'closed'
    log('erase the sign-in email', error)
  } catch (err) {
    log('erase the sign-in email', err)
  }
  try {
    const { error } = await admin.updateUserById(memberId, block)
    if (!error) return 'blocked'
    log('block the login', error)
  } catch (err) {
    log('block the login', err)
  }
  return 'open'
}

/**
 * Removes a member's account at their request (CC-4; privacy page "Removing
 * your account"). The caller must be an approved admin, checked from their
 * own profile. admin_remove_member runs with the admin's session (audited,
 * refuses yourself and the last admin): the account is closed and their
 * phone, employee ID, alerts and roster link are erased; names on trades stay.
 * Then the login is closed with the service key (closeLogin). Calling it
 * again for an account that is already removed only retries the login step,
 * which is how "Finish removal" works.
 */
export async function removeMember(memberId: string, reason: string): Promise<RemoveMemberActionResult> {
  try {
    const { sb, member } = await adminAndMember(
      memberId,
      "You can't remove your own account. Ask another admin to do it.",
    )
    const board = member.removed_at ? null : await adminRemoveMember(sb, memberId, reason)
    const login = await closeLogin(memberId)
    return { ok: true, board, login }
  } catch (err) {
    return failure(err, 'removeMember')
  }
}
