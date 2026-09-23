'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, FileText, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { Button, Card, useToast } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { errorMessage } from '@/lib/errors'
import { clearSnapshots } from '@/lib/offline-cache'
import { clearAppCaches, unsubscribeFromPush } from '@/lib/push/client'
import { createClient } from '@/lib/supabase/client'
import { ChangePasswordSheet } from './ChangePasswordSheet'
import { ProfileSection } from './ProfileSection'

const ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left font-semibold text-fg transition-colors hover:bg-white/[0.05]'

/** Password, admin/privacy links and sign out. */
export function AccountSection() {
  const { profile, isAdmin } = useProfile()
  const router = useRouter()
  const toast = useToast()
  const [changingPassword, setChangingPassword] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // ARCHITECTURE §9: turn off push for this device, clear caches and offline
  // snapshots, then end the session on this device only.
  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      const sb = createClient()
      await unsubscribeFromPush(sb)
      await clearAppCaches()
      clearSnapshots()
      const { error } = await sb.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch (error) {
      setSigningOut(false)
      toast.error("Couldn't sign out", errorMessage(error))
      return
    }
    // Stay busy until the login page takes over.
    router.replace('/login')
    router.refresh()
  }

  return (
    <ProfileSection id="profile-account" title="Account">
      <Card>
        <p className="text-sm text-fg-muted">
          Signed in as <span className="break-all font-semibold text-fg">{profile.email || 'your account'}</span>
        </p>

        <ul className="mt-3 divide-y divide-line">
          <li className="py-1">
            <button type="button" onClick={() => setChangingPassword(true)} className={ROW}>
              <RowContent icon={<KeyRound size={18} />}>Change password</RowContent>
            </button>
          </li>
          {isAdmin ? (
            <li className="py-1">
              <Link href="/admin" className={ROW}>
                <RowContent icon={<ShieldCheck size={18} />}>Admin tools</RowContent>
              </Link>
            </li>
          ) : null}
          <li className="py-1">
            <Link href="/privacy" className={ROW}>
              <RowContent icon={<FileText size={18} />}>Privacy &amp; disclaimer</RowContent>
            </Link>
          </li>
        </ul>

        <Button
          variant="danger"
          fullWidth
          className="mt-4"
          onClick={signOut}
          loading={signingOut}
          icon={<LogOut size={18} aria-hidden="true" />}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
        <p className="mt-2 text-center text-sm text-fg-dim">
          Signing out turns off alerts on this device and clears the data saved on it.
        </p>
      </Card>

      {changingPassword ? <ChangePasswordSheet onClose={() => setChangingPassword(false)} /> : null}
    </ProfileSection>
  )
}

function RowContent({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-fg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-fg-dim" />
    </>
  )
}
