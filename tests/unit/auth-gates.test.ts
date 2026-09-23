import { describe, expect, it } from 'vitest'
import {
  APP_HOME,
  canUsePage,
  gateRedirect,
  nextStepFor,
  type GateProfile,
  type OnboardPage,
} from '@/app/(onboard)/_lib/gates'

const STATUSES: GateProfile['status'][] = ['onboarding', 'pending', 'approved', 'rejected', 'suspended']
const PAGES: OnboardPage[] = ['/onboarding', '/pending', '/welcome', '/change-password']

function profile(overrides: Partial<GateProfile> = {}): GateProfile {
  return { status: 'approved', must_change_password: false, telestaff_ack_at: '2026-09-23T15:00:00Z', ...overrides }
}

/** Every combination of status × must_change_password × acknowledged. */
function everyProfile(): GateProfile[] {
  const out: GateProfile[] = []
  for (const status of STATUSES) {
    for (const must of [false, true]) {
      for (const ack of [null, '2026-09-23T15:00:00Z']) {
        out.push({ status, must_change_password: must, telestaff_ack_at: ack })
      }
    }
  }
  return out
}

/** The (app) layout's gate order (src/app/(app)/layout.tsx), for cross-checking. */
function appLayoutGate(p: GateProfile): string | null {
  if (p.status === 'onboarding') return '/onboarding'
  if (p.status !== 'approved') return '/pending'
  if (p.must_change_password) return '/change-password'
  if (!p.telestaff_ack_at) return '/welcome'
  return null
}

describe('nextStepFor', () => {
  it('sends each status to its step', () => {
    expect(nextStepFor(profile({ status: 'onboarding', telestaff_ack_at: null }))).toBe('/onboarding')
    expect(nextStepFor(profile({ status: 'pending' }))).toBe('/pending')
    expect(nextStepFor(profile({ status: 'rejected' }))).toBe('/pending')
    expect(nextStepFor(profile({ status: 'suspended' }))).toBe('/pending')
    expect(nextStepFor(profile({ telestaff_ack_at: null }))).toBe('/welcome')
    expect(nextStepFor(profile())).toBe(APP_HOME)
  })

  it('puts a forced password change before everything else', () => {
    for (const status of STATUSES) {
      expect(nextStepFor(profile({ status, must_change_password: true }))).toBe('/change-password')
    }
  })

  it('never treats an unknown status as approved', () => {
    const odd = { ...profile(), status: 'mystery' } as unknown as GateProfile
    expect(nextStepFor(odd)).toBe('/pending')
  })
})

describe('page gates', () => {
  it('always accept the member on the page nextStepFor picks (no loops, nobody stuck)', () => {
    for (const p of everyProfile()) {
      const next = nextStepFor(p)
      if (next === APP_HOME) continue
      expect(canUsePage(next, p), JSON.stringify(p)).toBe(true)
      expect(gateRedirect(next, p)).toBeNull()
    }
  })

  it('redirect to nextStepFor from any page the member may not use', () => {
    for (const p of everyProfile()) {
      for (const page of PAGES) {
        const target = gateRedirect(page, p)
        if (canUsePage(page, p)) expect(target).toBeNull()
        else expect(target).toBe(nextStepFor(p))
      }
    }
  })

  it('only send members to the app when the (app) layout lets them in', () => {
    for (const p of everyProfile()) {
      if (nextStepFor(p) === APP_HOME) expect(appLayoutGate(p)).toBeNull()
      else expect(appLayoutGate(p)).not.toBeNull()
    }
  })

  it('let pending members edit their details but not rejected or suspended ones', () => {
    expect(canUsePage('/onboarding', profile({ status: 'onboarding' }))).toBe(true)
    expect(canUsePage('/onboarding', profile({ status: 'pending' }))).toBe(true)
    expect(gateRedirect('/onboarding', profile({ status: 'rejected' }))).toBe('/pending')
    expect(gateRedirect('/onboarding', profile({ status: 'suspended' }))).toBe('/pending')
    expect(gateRedirect('/onboarding', profile({ telestaff_ack_at: null }))).toBe('/welcome')
    expect(gateRedirect('/onboarding', profile())).toBe(APP_HOME)
  })

  it('keep the waiting room for members who are not approved', () => {
    expect(gateRedirect('/pending', profile({ status: 'onboarding' }))).toBe('/onboarding')
    expect(gateRedirect('/pending', profile({ telestaff_ack_at: null }))).toBe('/welcome')
    expect(gateRedirect('/pending', profile({ status: 'rejected' }))).toBeNull()
  })

  it('let approved members finish the welcome steps after acknowledging', () => {
    expect(canUsePage('/welcome', profile({ telestaff_ack_at: null }))).toBe(true)
    expect(canUsePage('/welcome', profile())).toBe(true)
    expect(gateRedirect('/welcome', profile({ status: 'pending' }))).toBe('/pending')
    expect(gateRedirect('/welcome', profile({ must_change_password: true }))).toBe('/change-password')
  })

  it('open the password change page only when a change is required', () => {
    expect(canUsePage('/change-password', profile({ must_change_password: true }))).toBe(true)
    expect(canUsePage('/change-password', profile({ status: 'pending', must_change_password: true }))).toBe(true)
    expect(gateRedirect('/change-password', profile())).toBe(APP_HOME)
    expect(gateRedirect('/change-password', profile({ status: 'pending' }))).toBe('/pending')
  })
})
