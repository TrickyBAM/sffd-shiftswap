// The signed-in app's gates (src/app/(app)/layout.tsx, ARCHITECTURE §7.1):
// no session → /login; onboarding → /onboarding; pending|rejected|suspended →
// /pending; must_change_password → /change-password; no TeleStaff
// acknowledgment → /welcome; otherwise the app shell. A database or network
// error renders an error screen and never redirects as if there were no profile.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { AppError } from '@/lib/errors'
import type { Profile } from '@/lib/types/database'

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`)
  }
}

const mocks = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  createClient: vi.fn(async () => ({ auth: {} })),
  redirect: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ getMyProfile: mocks.getMyProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
// unstable_rethrow only rethrows Next.js control-flow errors; a no-op is enough here.
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: () => {} }))

const ME = '11111111-1111-4111-8111-111111111111'

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: ME,
    email: 'brian@example.com',
    full_name: 'Brian Machado',
    phone: '415-555-0100',
    rank: 'Firefighter',
    station: 19,
    battalion: 9,
    division: 3,
    tour: 2,
    employee_id: null,
    status: 'approved',
    status_reason: null,
    role: 'member',
    roster_id: null,
    telestaff_ack_at: '2026-09-01T12:00:00Z',
    must_change_password: false,
    notify_scope: 'battalion',
    calendar_token: '5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f',
    approved_at: '2026-09-01T12:00:00Z',
    approved_by: null,
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    ...overrides,
  } as Profile
}

type Outcome = { redirectedTo: string } | { element: ReactElement<Record<string, unknown>> }

async function renderLayout(children: ReactNode = 'page'): Promise<Outcome> {
  const { default: AppLayout } = await import('@/app/(app)/layout')
  try {
    const element = (await AppLayout({ children })) as ReactElement<Record<string, unknown>>
    return { element }
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirectedTo: error.url }
    throw error
  }
}

describe('(app) layout gates', () => {
  beforeEach(() => {
    mocks.getMyProfile.mockReset()
    mocks.redirect.mockReset()
    mocks.redirect.mockImplementation((url: string) => {
      throw new RedirectSignal(url)
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends signed-out visitors to /login', async () => {
    mocks.getMyProfile.mockRejectedValue(new AppError('NOT_SIGNED_IN'))
    expect(await renderLayout()).toEqual({ redirectedTo: '/login' })
  })

  it.each([
    [{ status: 'onboarding' as const }, '/onboarding'],
    [{ status: 'onboarding' as const, must_change_password: true, telestaff_ack_at: null }, '/onboarding'],
    [{ status: 'pending' as const }, '/pending'],
    [{ status: 'rejected' as const }, '/pending'],
    [{ status: 'suspended' as const, must_change_password: true }, '/pending'],
    [{ must_change_password: true, telestaff_ack_at: null }, '/change-password'],
    [{ telestaff_ack_at: null }, '/welcome'],
  ])('gates %o to %s', async (overrides, destination) => {
    mocks.getMyProfile.mockResolvedValue(profile(overrides))
    expect(await renderLayout()).toEqual({ redirectedTo: destination })
  })

  it('renders the app shell with the profile for an approved, acknowledged member', async () => {
    const me = profile()
    mocks.getMyProfile.mockResolvedValue(me)
    const { ProfileProvider } = await import('@/components/providers/ProfileProvider')
    const { default: AppShell } = await import('@/components/AppShell')

    const outcome = await renderLayout('the page')
    expect(mocks.redirect).not.toHaveBeenCalled()
    if (!('element' in outcome)) throw new Error('expected an element')
    expect(outcome.element.type).toBe(ProfileProvider)
    expect(outcome.element.props.profile).toBe(me)
    const shell = outcome.element.props.children as ReactElement<{ children: ReactNode }>
    expect(shell.type).toBe(AppShell)
    expect(shell.props.children).toBe('the page')
  })

  it('shows an error screen (no redirect) when the database cannot be reached', async () => {
    mocks.getMyProfile.mockRejectedValue(new AppError('NETWORK'))
    const outcome = await renderLayout()
    expect(mocks.redirect).not.toHaveBeenCalled()
    if (!('element' in outcome)) throw new Error('expected an element')
    expect(outcome.element.props).toMatchObject({
      title: "Can't load ShiftSwap",
      message: "Can't reach ShiftSwap right now. Check your connection and try again.",
    })
  })

  it('shows an error screen (no redirect) on any other failure, e.g. Supabase not configured', async () => {
    mocks.createClient.mockRejectedValueOnce(
      Object.assign(new Error('Supabase is not configured: missing NEXT_PUBLIC_SUPABASE_URL.'), { name: 'MissingEnvError' }),
    )
    const outcome = await renderLayout()
    expect(mocks.redirect).not.toHaveBeenCalled()
    if (!('element' in outcome)) throw new Error('expected an element')
    expect(outcome.element.props.title).toBe("Can't load ShiftSwap")
    // Configuration problems fail loudly with what to set (§7.4) — names, never values.
    expect(String(outcome.element.props.message)).toContain('not configured')
  })

  it('offers sign-out (instead of onboarding) when the profile row is missing', async () => {
    mocks.getMyProfile.mockResolvedValue(null)
    const outcome = await renderLayout()
    expect(mocks.redirect).not.toHaveBeenCalled()
    if (!('element' in outcome)) throw new Error('expected an element')
    expect(outcome.element.props).toMatchObject({ title: 'Account not found', offerSignOut: true })
  })
})
