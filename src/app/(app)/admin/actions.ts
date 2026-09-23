'use server'

// Admin server actions. Only async functions may be exported from this file.

import { getMember, getMyProfile, isUuid, markMustChangePassword } from '@/lib/api'
import { AppError, toAppError, type AppErrorCode } from '@/lib/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { generateTempPassword } from './_lib/temp-password'

export type ResetPasswordResult =
  | {
      ok: true
      /** The temporary password. Shown to the admin once; never stored or logged. */
      password: string
      /** False when the password was set but the "change it at next sign-in" flag couldn't be saved. */
      forcedChange: boolean
    }
  | { ok: false; code: AppErrorCode; message: string }

/**
 * Resets a member's password to a readable temporary one (ARCHITECTURE §1:
 * no email; admins reset forgotten passwords). The caller must be an approved
 * admin, checked here from their own profile with their own session. The new
 * password is set with the service key, then admin_mark_must_change_password
 * runs as the admin (audited) so the member must pick a new one at sign-in.
 */
export async function resetMemberPassword(memberId: string): Promise<ResetPasswordResult> {
  try {
    if (!isUuid(memberId)) throw new AppError('INVALID_INPUT', "That member link isn't valid.")

    const sb = await createClient()
    const me = await getMyProfile(sb)
    if (!me || me.role !== 'admin' || me.status !== 'approved') throw new AppError('NOT_ADMIN')
    if (me.id === memberId) {
      throw new AppError('INVALID_INPUT', 'To change your own password, use Change password on your Profile page.')
    }

    const member = await getMember(sb, memberId)
    if (!member) throw new AppError('NOT_FOUND', "That member wasn't found.")

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
    const error = toAppError(err)
    if (error.code === 'UNKNOWN' || error.code === 'NETWORK') {
      console.error('resetMemberPassword failed', error.details ?? error.message)
    }
    return { ok: false, code: error.code, message: error.message }
  }
}
