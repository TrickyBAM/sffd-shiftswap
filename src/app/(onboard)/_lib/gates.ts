// Where a signed-in member belongs while they finish joining (ARCHITECTURE
// §7.1 "Gates"). Pure functions, shared by the (onboard) pages (server
// redirects) and their client components (where to go after a step), and
// unit-tested in tests/unit/auth-gates.test.ts.
//
// Rules, in order:
//   must_change_password              → /change-password (a temporary password an
//                                       admin knows must be replaced before anything else)
//   status onboarding                 → /onboarding
//   status pending|rejected|suspended → /pending
//   approved, TeleStaff not acknowledged → /welcome
//   approved and acknowledged         → /calendar (the app)
//
// Each (onboard) page accepts exactly the members whose next step it is (plus
// /onboarding for editing while pending, and /welcome after acknowledging so
// the install/alerts steps can be finished). A member on the wrong page is
// sent to nextStepFor(), which is always a page that accepts them, so the
// gates can never loop and nobody can skip a step or get stuck. They also
// agree with the (app) layout's gates: /calendar is only ever the answer when
// that layout lets the member in.

export type OnboardPage = '/onboarding' | '/pending' | '/welcome' | '/change-password'

export const APP_HOME = '/calendar'

/** The profile fields the gates look at (a structural subset of the profiles row). */
export interface GateProfile {
  status: 'onboarding' | 'pending' | 'approved' | 'rejected' | 'suspended'
  must_change_password: boolean
  telestaff_ack_at: string | null
}

/** Where this member should be right now. */
export function nextStepFor(profile: GateProfile): OnboardPage | typeof APP_HOME {
  if (profile.must_change_password) return '/change-password'
  switch (profile.status) {
    case 'onboarding':
      return '/onboarding'
    case 'pending':
    case 'rejected':
    case 'suspended':
      return '/pending'
    case 'approved':
      return profile.telestaff_ack_at ? APP_HOME : '/welcome'
    default:
      // An unknown status is never "approved".
      return '/pending'
  }
}

/** True when `page` is a page this member may use now. */
export function canUsePage(page: OnboardPage, profile: GateProfile): boolean {
  if (page === '/change-password') return profile.must_change_password
  if (profile.must_change_password) return false
  switch (page) {
    case '/onboarding':
      // First-time setup, or editing details while waiting for approval.
      return profile.status === 'onboarding' || profile.status === 'pending'
    case '/pending':
      return profile.status === 'pending' || profile.status === 'rejected' || profile.status === 'suspended'
    case '/welcome':
      // Also after acknowledging, so the install and alerts steps can be finished.
      return profile.status === 'approved'
    default:
      return false
  }
}

/** Null when the member may stay on `page`, otherwise where to send them. */
export function gateRedirect(page: OnboardPage, profile: GateProfile): string | null {
  return canUsePage(page, profile) ? null : nextStepFor(profile)
}
