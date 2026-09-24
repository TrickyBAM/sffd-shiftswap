import type { ReactNode } from 'react'
import { redirect, unstable_rethrow } from 'next/navigation'
import { getAdminOverview, getMyProfile, type Sb } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import type { AdminOverview, Profile } from '@/lib/types/database'
import { AdminGateError } from './_components/AdminGateError'
import { AdminProvider } from './_components/AdminProvider'

type Gate = { ok: true; sb: Sb; profile: Profile | null } | { ok: false; code: string; message: string }

async function readMyProfile(): Promise<Gate> {
  try {
    const sb = await createClient()
    return { ok: true, sb, profile: await getMyProfile(sb) }
  } catch (err) {
    // Let Next.js's own control-flow errors (dynamic rendering, redirects) through.
    unstable_rethrow(err)
    const error = toAppError(err)
    return { ok: false, code: error.code, message: error.message }
  }
}

/**
 * /admin/** — approved admins only (ARCHITECTURE §7.1). Everyone else goes to
 * the calendar. A failure to read the profile shows an error with retry; it is
 * never treated as "not an admin".
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const gate = await readMyProfile()
  if (!gate.ok) {
    if (gate.code === 'NOT_SIGNED_IN') redirect('/login?next=%2Fadmin')
    return <AdminGateError message={gate.message} />
  }
  const { sb, profile } = gate
  if (!profile || profile.role !== 'admin' || profile.status !== 'approved') redirect('/calendar')

  let overview: AdminOverview | null = null
  let overviewError: string | null = null
  try {
    overview = await getAdminOverview(sb)
  } catch (err) {
    // Let Next.js's own control-flow errors (dynamic rendering, redirects) through.
    unstable_rethrow(err)
    overviewError = toAppError(err).message
  }

  return (
    <AdminProvider initialOverview={overview} initialError={overviewError}>
      {children}
    </AdminProvider>
  )
}
