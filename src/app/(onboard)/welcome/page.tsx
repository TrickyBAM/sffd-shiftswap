import type { Metadata } from 'next'
import { requireOnboardPage } from '../_lib/load-profile'
import { WelcomeSteps } from './_components/WelcomeSteps'

export const metadata: Metadata = {
  title: 'Welcome',
}

/**
 * First steps for an approved member: the one-time TeleStaff acknowledgment
 * (required), then installing the app and turning on alerts (both optional).
 * A member who already acknowledged starts at the install step.
 */
export default async function WelcomePage() {
  const gate = await requireOnboardPage('/welcome')
  if (!gate) return null
  const { profile } = gate
  const firstName = profile.full_name.trim().split(/\s+/)[0] ?? ''

  return <WelcomeSteps acknowledged={Boolean(profile.telestaff_ack_at)} firstName={firstName} />
}
