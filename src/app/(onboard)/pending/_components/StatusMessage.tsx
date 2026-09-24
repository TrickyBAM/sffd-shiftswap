import { Ban, CirclePause, Hourglass } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/components/ui/cn'
import type { Profile } from '@/lib/types/database'

export interface StatusMessageProps {
  profile: Pick<Profile, 'status' | 'status_reason' | 'phone'>
}

function Reason({ text }: { text: string | null }) {
  const reason = text?.trim()
  if (!reason) return null
  return (
    <blockquote className="mt-3 rounded-xl border border-line bg-elevated px-4 py-3 text-sm text-fg">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-dim">Reason from the admin</p>
      <p className="mt-1 whitespace-pre-line break-words">{reason}</p>
    </blockquote>
  )
}

/** The explanation for a member who can't use ShiftSwap yet, by status. */
export function StatusMessage({ profile }: StatusMessageProps) {
  const phone = profile.phone?.trim()

  if (profile.status === 'rejected' || profile.status === 'suspended') {
    const rejected = profile.status === 'rejected'
    const Icon = rejected ? Ban : CirclePause
    return (
      <Card as="section" aria-labelledby="status-title" className="animate-fade-in-up">
        <Icon size={28} aria-hidden="true" className={cn('mb-3', rejected ? 'text-sffd-red-text' : 'text-accent-yellow')} />
        <h2 id="status-title" className="font-display text-2xl leading-tight text-fg">
          {rejected ? "Your account wasn't approved" : 'Your account is paused'}
        </h2>
        <p className="mt-2 text-sm text-fg-muted">
          {rejected
            ? "A ShiftSwap admin reviewed your sign-up and didn't approve it."
            : "A ShiftSwap admin has paused your account, so you can't post or trade shifts for now."}
        </p>
        <Reason text={profile.status_reason} />
        <p className="mt-3 text-sm text-fg-muted">
          If you think this is a mistake, contact a ShiftSwap admin. This page updates by itself if they change
          it.
        </p>
      </Card>
    )
  }

  return (
    <Card as="section" aria-labelledby="status-title" className="animate-fade-in-up">
      <Hourglass size={28} aria-hidden="true" className="mb-3 text-accent-yellow" />
      <h2 id="status-title" className="font-display text-2xl leading-tight text-fg">
        You&apos;re in line for approval
      </h2>
      <p className="mt-2 text-sm text-fg-muted">
        We couldn&apos;t automatically match you to the department roster, so an admin will review your account
        — usually within a day.{' '}
        {phone ? (
          <>
            They may call or text you at <span className="whitespace-nowrap font-semibold text-fg">{phone}</span>.
          </>
        ) : (
          'They may reach out using the details you gave.'
        )}
      </p>
      <p className="mt-3 text-sm text-fg-muted">
        You don&apos;t need to keep this page open. We&apos;ll let you in as soon as you&apos;re approved.
      </p>
    </Card>
  )
}
