import type { Metadata } from 'next'
import { OnboardHeader } from '../_components/OnboardHeader'
import { nextStepFor } from '../_lib/gates'
import { requireOnboardPage } from '../_lib/load-profile'
import { ChangePasswordForm } from './_components/ChangePasswordForm'

export const metadata: Metadata = {
  title: 'Choose a new password',
}

/**
 * Forced password change after an admin reset (profiles.must_change_password).
 * Nothing else opens until it's done.
 */
export default async function ChangePasswordPage() {
  const gate = await requireOnboardPage('/change-password')
  if (!gate) return null
  // Where to go once the flag is cleared (usually the calendar).
  const next = nextStepFor({ ...gate.profile, must_change_password: false })

  return (
    <>
      <OnboardHeader title="Choose a new password" />
      <div className="mx-auto w-full max-w-xl px-4 py-6">
        <ChangePasswordForm next={next} email={gate.profile.email} />
      </div>
    </>
  )
}
