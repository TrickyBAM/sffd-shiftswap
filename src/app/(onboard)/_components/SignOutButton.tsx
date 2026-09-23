'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/Button'
import { signOutOnThisDevice } from '../_lib/sign-out'

export type SignOutButtonProps = Omit<ButtonProps, 'onClick' | 'loading' | 'children'>

/** "Sign out" with the full sign-out sequence; stays busy until the login page loads. */
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
