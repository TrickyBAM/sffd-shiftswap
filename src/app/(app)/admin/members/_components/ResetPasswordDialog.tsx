'use client'

import { useRef, useState } from 'react'
import { Check, Copy, MessageSquare } from 'lucide-react'
import { Button, Dialog, buttonClasses, useToast } from '@/components/ui'
import type { Profile } from '@/lib/types/database'
import { resetMemberPassword } from '../../actions'
import { smsHref } from '../../_lib/format'
import { firstNameOf, tempPasswordMessage } from '../_lib/password'

export interface ResetPasswordDialogProps {
  member: Pick<Profile, 'id' | 'full_name' | 'email' | 'phone'>
  onClose: () => void
  /** Called once the password has been changed (reload the member). */
  onReset: () => void
}

type Phase =
  | { step: 'confirm'; busy: boolean; error: string | null }
  | { step: 'done'; password: string; forcedChange: boolean }

/**
 * Resets a member's password to a readable temporary one (server action),
 * then shows it once with Copy and "Text it".
 */
export function ResetPasswordDialog({ member, onClose, onReset }: ResetPasswordDialogProps) {
  const toast = useToast()
  const [phase, setPhase] = useState<Phase>({ step: 'confirm', busy: false, error: null })
  const [copied, setCopied] = useState(false)
  const passwordRef = useRef<HTMLElement>(null)
  const name = member.full_name || member.email || 'this member'
  const firstName = firstNameOf(member.full_name)

  async function reset() {
    if (phase.step !== 'confirm' || phase.busy) return
    setPhase({ step: 'confirm', busy: true, error: null })
    try {
      const result = await resetMemberPassword(member.id)
      if (!result.ok) {
        setPhase({ step: 'confirm', busy: false, error: result.message })
        toast.error("Couldn't reset the password", result.message)
        return
      }
      setPhase({ step: 'done', password: result.password, forcedChange: result.forcedChange })
      onReset()
    } catch {
      const message = "Can't reach ShiftSwap right now. Check your connection and try again."
      setPhase({ step: 'confirm', busy: false, error: message })
      toast.error("Couldn't reset the password", message)
    }
  }

  async function copy(password: string) {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      toast.success('Password copied')
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      const node = passwordRef.current
      const selection = typeof window !== 'undefined' ? window.getSelection() : null
      if (node && selection) {
        const range = document.createRange()
        range.selectNodeContents(node)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      toast.info("Couldn't copy automatically", 'The password is selected. Copy it from your phone’s menu.')
    }
  }

  if (phase.step === 'confirm') {
    return (
      <Dialog
        open
        onClose={phase.busy ? () => {} : onClose}
        role="alertdialog"
        closeOnOverlay={!phase.busy}
        closeOnEscape={!phase.busy}
        title={`Reset ${name}'s password?`}
        description="Their current password stops working right away. You'll get a temporary password to give them."
        actions={
          <>
            <Button variant="secondary" onClick={onClose} disabled={phase.busy}>
              Cancel
            </Button>
            <Button onClick={reset} loading={phase.busy}>
              Reset password
            </Button>
          </>
        }
      >
        {phase.error ? (
          <p
            role="alert"
            className="rounded-xl border border-sffd-red/30 bg-sffd-red/10 px-3 py-2 text-sm text-sffd-red-text"
          >
            {phase.error}
          </p>
        ) : null}
      </Dialog>
    )
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const sms = smsHref(member.phone, tempPasswordMessage(firstName, phase.password, origin))

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnOverlay={false}
      title="Temporary password"
      description={`Give this to ${name}. It's only shown once.`}
      actions={
        <Button onClick={onClose} className="sm:min-w-28">
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="rounded-2xl border border-line-strong bg-elevated px-4 py-4 text-center">
          <span className="sr-only">Temporary password: </span>
          <code ref={passwordRef} className="select-all break-all font-mono text-2xl font-semibold tracking-wide text-fg">
            {phase.password}
          </code>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            icon={copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
            onClick={() => void copy(phase.password)}
            className="sm:flex-1"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          {sms ? (
            <a href={sms} className={buttonClasses({ variant: 'secondary', className: 'sm:flex-1' })}>
              <MessageSquare size={18} aria-hidden="true" />
              Text it
            </a>
          ) : null}
        </div>
        <p className="text-sm text-fg-muted">They&apos;ll be asked to choose a new password when they log in.</p>
        {!phase.forcedChange ? (
          <p role="alert" className="text-sm text-accent-yellow">
            We couldn&apos;t switch on the “choose a new password” step. Ask them to change it from their Profile page
            after signing in.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
