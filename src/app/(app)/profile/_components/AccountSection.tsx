'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { signOutOnThisDevice } from '@/lib/auth/sign-out'
import { ChangePasswordSheet } from './ChangePasswordSheet'
import { ProfileSection } from './ProfileSection'

const ROW =
  'flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left font-semibold text-fg transition-colors hover:bg-white/[0.05]'

/** Password, admin/privacy links and sign out. */
export function AccountSection() {
  const { profile, isAdmin } = useProfile()
  const [changingPassword, setChangingPassword] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // The one sign-out path (src/lib/auth/sign-out.ts): turns off alerts on this
  // device, clears saved data and ends the session here, even with no signal,
  // then fully reloads /login so nothing of this member stays on screen or in
  // memory. It never fails, so the button stays busy until /login loads.
  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    await signOutOnThisDevice()
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
