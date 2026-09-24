'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/Button'
import { signOutOnThisDevice } from '@/lib/auth/sign-out'

export type SignOutButtonProps = Omit<ButtonProps, 'onClick' | 'loading' | 'children'>

/**
 * "Sign out" for the joining steps and the gate error screens. Runs the app's
 * one sign-out (src/lib/auth/sign-out.ts), which always ends with a full load
 * of /login, so the button stays busy until that page takes over.
 */
export function SignOutButton({ variant = 'ghost', ...props }: SignOutButtonProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      {...props}
      variant={variant}
      loading={busy}
      icon={<LogOut size={16} aria-hidden="true" />}
      onClick={async () => {
        if (busy) return
        setBusy(true)
        await signOutOnThisDevice()
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
