// When a background profile re-check must reload the app so the server gates
// run (NEXT-08; src/components/providers/ProfileProvider.tsx).

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

import { profileNeedsGate, type MyProfile } from '@/components/providers/ProfileProvider'

function me(overrides: Partial<MyProfile> = {}): MyProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
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
  }
}

describe('profileNeedsGate', () => {
  it('no change that matters: keep going', () => {
    expect(profileNeedsGate(me(), me())).toBe(false)
    expect(profileNeedsGate(me(), me({ phone: '415-555-0199', station: 7, removed_at: null }))).toBe(false)
  })

  it.each([
    ['suspended', { status: 'suspended' as const }],
    ['rejected', { status: 'rejected' as const }],
    ['sent back to pending', { status: 'pending' as const }],
    ['made an admin', { role: 'admin' as const }],
    ['forced password change', { must_change_password: true }],
    ['removed', { removed_at: '2026-09-23T18:00:00Z' }],
  ])('%s → reload', (_label, change) => {
    expect(profileNeedsGate(me(), me(change))).toBe(true)
  })

  it('an admin who lost the role reloads too, and a missing row reloads', () => {
    expect(profileNeedsGate(me({ role: 'admin' }), me())).toBe(true)
    expect(profileNeedsGate(me(), null)).toBe(true)
  })
})
