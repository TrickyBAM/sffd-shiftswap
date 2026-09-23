import type { Metadata } from 'next'
import { requireOnboardPage } from '../_lib/load-profile'
import { PendingView } from './_components/PendingView'

export const metadata: Metadata = {
  title: 'Account status',
}

/**
 * The waiting room for members who aren't approved: pending (waiting for an
 * admin), rejected or suspended. Checks for approval every 20 seconds and
 * moves the member on as soon as it happens.
 */
export default async function PendingPage() {
  const gate = await requireOnboardPage('/pending')
  if (!gate) return null
  return <PendingView initialProfile={gate.profile} />
}
