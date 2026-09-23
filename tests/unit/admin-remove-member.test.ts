import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { Profile } from '@/lib/types/database'

// The server actions' collaborators: the admin's own session client, the
// service-role client and the src/lib/api wrappers they call.
const mocks = vi.hoisted(() => ({
  sb: { tag: 'admin-session' },
  getMyProfile: vi.fn(),
  getMember: vi.fn(),
  adminRemoveMember: vi.fn(),
  markMustChangePassword: vi.fn(),
  updateUserById: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.sb }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
}))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getMyProfile: mocks.getMyProfile,
  getMember: mocks.getMember,
  adminRemoveMember: mocks.adminRemoveMember,
  markMustChangePassword: mocks.markMustChangePassword,
}))

import { removeMember, resetMemberPassword } from '@/app/(app)/admin/actions'

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const MIKE_ID = '22222222-2222-4222-8222-222222222222'
const PLACEHOLDER = `removed+${MIKE_ID}@shiftswap.invalid`
const BOARD = { posts_cancelled: 1, requests_closed: 2, upcoming_trades: 0 }

function profile(partial: Partial<Profile>): Profile {
  return {
    id: MIKE_ID,
    email: 'mike@example.com',
    full_name: 'Mike Lee',
    phone: '415-555-0123',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    tour: 7,
    employee_id: '12345',
    status: 'approved',
    status_reason: null,
    role: 'member',
    roster_id: null,
    telestaff_ack_at: null,
    must_change_password: false,
    notify_scope: 'battalion',
    calendar_token: '66666666-6666-4666-8666-666666666666',
    approved_at: null,
    approved_by: null,
    removed_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...partial,
  }
}

const admin = profile({ id: ADMIN_ID, full_name: 'Brian Machado', role: 'admin' })

describe('removeMember server action', () => {
  beforeEach(() => {
    mocks.getMyProfile.mockReset().mockResolvedValue(admin)
    mocks.getMember.mockReset().mockResolvedValue(profile({}))
    mocks.adminRemoveMember.mockReset().mockResolvedValue(BOARD)
    mocks.updateUserById.mockReset().mockResolvedValue({ data: { user: {} }, error: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('removes the account with the admin session, then erases the email and bans the login', async () => {
    await expect(removeMember(MIKE_ID, 'Retired')).resolves.toEqual({ ok: true, board: BOARD, login: 'closed' })
    expect(mocks.adminRemoveMember).toHaveBeenCalledWith(mocks.sb, MIKE_ID, 'Retired')
    expect(mocks.updateUserById).toHaveBeenCalledTimes(1)
    expect(mocks.updateUserById).toHaveBeenCalledWith(MIKE_ID, {
      email: PLACEHOLDER,
      ban_duration: '876000h',
      user_metadata: { phone: null },
    })
    // The database step runs first, so a refusal there never touches the login.
    expect(mocks.adminRemoveMember.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateUserById.mock.invocationCallOrder[0],
    )
  })

  it('only lets approved admins do it', async () => {
    mocks.getMyProfile.mockResolvedValue(profile({ id: ADMIN_ID, role: 'member' }))
    await expect(removeMember(MIKE_ID, 'x')).resolves.toMatchObject({ ok: false, code: 'NOT_ADMIN' })
    mocks.getMyProfile.mockResolvedValue(profile({ id: ADMIN_ID, role: 'admin', status: 'suspended' }))
    await expect(removeMember(MIKE_ID, 'x')).resolves.toMatchObject({ ok: false, code: 'NOT_ADMIN' })
    mocks.getMyProfile.mockResolvedValue(null)
    await expect(removeMember(MIKE_ID, 'x')).resolves.toMatchObject({ ok: false, code: 'NOT_ADMIN' })
    expect(mocks.adminRemoveMember).not.toHaveBeenCalled()
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('refuses your own account, a bad id and a missing member', async () => {
    await expect(removeMember(ADMIN_ID, 'x')).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    await expect(removeMember('not-an-id', 'x')).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    mocks.getMember.mockResolvedValue(null)
    await expect(removeMember(MIKE_ID, 'x')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(mocks.adminRemoveMember).not.toHaveBeenCalled()
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it("passes on the database's refusal and leaves the login alone", async () => {
    mocks.adminRemoveMember.mockRejectedValue(
      new AppError('LAST_ADMIN', "You can't remove the last admin. Make someone else an admin first."),
    )
    await expect(removeMember(MIKE_ID, 'x')).resolves.toEqual({
      ok: false,
      code: 'LAST_ADMIN',
      message: "You can't remove the last admin. Make someone else an admin first.",
    })
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('still blocks the login when the email change is refused', async () => {
    mocks.updateUserById
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'Unable to validate email address', status: 400 } })
      .mockResolvedValueOnce({ data: { user: {} }, error: null })
    await expect(removeMember(MIKE_ID, 'x')).resolves.toEqual({ ok: true, board: BOARD, login: 'blocked' })
    expect(mocks.updateUserById).toHaveBeenLastCalledWith(MIKE_ID, {
      ban_duration: '876000h',
      user_metadata: { phone: null },
    })
  })

  it('reports an open login when the service key calls fail, without undoing the removal', async () => {
    mocks.updateUserById.mockRejectedValue(new TypeError('fetch failed'))
    await expect(removeMember(MIKE_ID, 'x')).resolves.toEqual({ ok: true, board: BOARD, login: 'open' })
    expect(mocks.updateUserById).toHaveBeenCalledTimes(2)
  })

  it('only retries the login step for an account that is already removed (Finish removal)', async () => {
    mocks.getMember.mockResolvedValue(profile({ status: 'suspended', removed_at: '2026-09-23T15:00:00Z', phone: null }))
    await expect(removeMember(MIKE_ID, '')).resolves.toEqual({ ok: true, board: null, login: 'closed' })
    expect(mocks.adminRemoveMember).not.toHaveBeenCalled()
    expect(mocks.updateUserById).toHaveBeenCalledWith(MIKE_ID, expect.objectContaining({ email: PLACEHOLDER }))
  })
})

describe('resetMemberPassword server action', () => {
  beforeEach(() => {
    mocks.getMyProfile.mockReset().mockResolvedValue(admin)
    mocks.getMember.mockReset().mockResolvedValue(profile({}))
    mocks.markMustChangePassword.mockReset().mockResolvedValue(undefined)
    mocks.updateUserById.mockReset().mockResolvedValue({ data: { user: {} }, error: null })
  })

  it('sets a temporary password and forces a change', async () => {
    const result = await resetMemberPassword(MIKE_ID)
    expect(result).toMatchObject({ ok: true, forcedChange: true })
    expect(mocks.updateUserById).toHaveBeenCalledWith(MIKE_ID, { password: expect.any(String) })
    expect(mocks.markMustChangePassword).toHaveBeenCalledWith(mocks.sb, MIKE_ID)
  })

  it("won't reset a removed account's password", async () => {
    mocks.getMember.mockResolvedValue(profile({ status: 'suspended', removed_at: '2026-09-23T15:00:00Z' }))
    await expect(resetMemberPassword(MIKE_ID)).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  it('refuses your own password', async () => {
    await expect(resetMemberPassword(ADMIN_ID)).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })
})
