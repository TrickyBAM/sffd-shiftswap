'use client'

import { Mail, MessageCircle, Phone } from 'lucide-react'
import { Avatar, Card, CardHeader, ErrorState, Skeleton, buttonClasses } from '@/components/ui'
import type { AppError } from '@/lib/errors'
import { smsHref, telHref } from '@/lib/format'
import { stationLabel } from '@/lib/sffd/stations'
import type { TradeContact } from '@/lib/types/database'

export interface ContactCardProps {
  contacts: readonly TradeContact[]
  /** The other member of the trade. */
  otherId: string | null
  otherName: string
  loading: boolean
  error: AppError | null
  onRetry: () => void
}

/** The trade partner's phone and email (get_trade_contact) with tap-to-call, text and email. */
export function ContactCard({ contacts, otherId, otherName, loading, error, onRetry }: ContactCardProps) {
  const contact = contacts.find((c) => c.user_id === otherId) ?? null
  const tel = telHref(contact?.phone)
  const sms = smsHref(contact?.phone)
  const callable = Boolean(tel && sms)

  return (
    <Card as="section" aria-labelledby="trade-contact-title">
      <CardHeader
        title={<span id="trade-contact-title">Contact {contact?.full_name ?? otherName}</span>}
        description="Only the two of you in this trade can see each other's number."
      />

      {loading && !contact ? (
        <div role="status" className="space-y-2">
          <span className="sr-only">Loading contact details…</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error && !contact ? (
        <ErrorState
          title="Couldn't load their contact details"
          message={error.message}
          onRetry={onRetry}
          className="py-6"
        />
      ) : !contact ? (
        <p className="text-sm text-fg-muted">
          Their contact details aren&apos;t available right now. You can still message them below.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Avatar name={contact.full_name} colorKey={contact.user_id} />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-fg">{contact.full_name}</p>
              <p className="text-fg-muted">
                {[contact.rank, contact.station != null ? stationLabel(contact.station) : null].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <dl className="mt-3 space-y-1 text-sm">
            {contact.phone ? (
              <div className="flex gap-2">
                <dt className="text-fg-dim">Phone</dt>
                <dd className="min-w-0 break-words text-fg">{contact.phone}</dd>
              </div>
            ) : null}
            {contact.email ? (
              <div className="flex gap-2">
                <dt className="text-fg-dim">Email</dt>
                <dd className="min-w-0 break-all text-fg">{contact.email}</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {tel && sms ? (
              <>
                <a
                  href={tel}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  aria-label={`Call ${contact.full_name}`}
                >
                  <Phone size={16} aria-hidden="true" />
                  Call
                </a>
                <a
                  href={sms}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  aria-label={`Text ${contact.full_name}`}
                >
                  <MessageCircle size={16} aria-hidden="true" />
                  Text
                </a>
              </>
            ) : null}
            {contact.email ? (
              <a
                href={`mailto:${encodeURIComponent(contact.email).replace(/%40/g, '@')}`}
                className={buttonClasses({ variant: 'secondary', size: 'sm', className: callable ? '' : 'col-span-3' })}
                aria-label={`Email ${contact.full_name}`}
              >
                <Mail size={16} aria-hidden="true" />
                Email
              </a>
            ) : null}
          </div>
          {!callable ? <p className="mt-2 text-sm text-fg-muted">No phone number on file.</p> : null}
        </>
      )}
    </Card>
  )
}
