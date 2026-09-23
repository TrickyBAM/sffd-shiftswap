import type { Metadata } from 'next'
import { OnboardHeader } from '../_components/OnboardHeader'
import { requireOnboardPage } from '../_lib/load-profile'
import { OnboardingForm, type OnboardingDefaults } from './_components/OnboardingForm'

export const metadata: Metadata = {
  title: 'Set up your profile',
}

/**
 * First-time profile setup (status onboarding), or editing it while waiting
 * for approval (status pending). Approved members go on to /welcome or the
 * app; rejected/suspended members to /pending (see _lib/gates.ts).
 */
export default async function OnboardingPage() {
  const gate = await requireOnboardPage('/onboarding')
  if (!gate) return null
  const { profile, signup } = gate
  const editing = profile.status === 'pending'

  const defaults: OnboardingDefaults = {
    fullName: profile.full_name || signup.fullName || '',
    phone: profile.phone ?? signup.phone ?? '',
    rank: profile.rank ?? '',
    station: profile.station,
    // Before the first save a null tour means "not chosen yet", so the member
    // must pick; after it, null is their "No tour" answer.
    tour: editing ? profile.tour : undefined,
    employeeId: profile.employee_id ?? '',
  }

  return (
    <>
      <OnboardHeader
        title={editing ? 'Edit my details' : 'Set up your profile'}
        subtitle={editing ? "Fix anything that's wrong — we'll check the roster again." : 'A few details so we can match you to the roster.'}
      />
      <div className="mx-auto w-full max-w-xl px-4 py-6">
        <OnboardingForm defaults={defaults} editing={editing} email={profile.email} />
      </div>
    </>
  )
}
