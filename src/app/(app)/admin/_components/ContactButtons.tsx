import { Mail, MessageSquare, Phone } from 'lucide-react'
import { buttonClasses, cn } from '@/components/ui'
import { smsHref, telHref } from '@/lib/format'

export interface ContactButtonsProps {
  name: string
  phone: string | null | undefined
  email?: string | null
  /** Prefilled text message for the Text button. */
  smsBody?: string
  className?: string
}

/** Call / Text / Email buttons for reaching a member (tel:, sms:, mailto:). */
export function ContactButtons({ name, phone, email, smsBody, className }: ContactButtonsProps) {
  const tel = telHref(phone)
  const sms = smsHref(phone, smsBody)
  const who = name || 'this member'
  if (!tel && !email) return null
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {tel ? (
        <a href={tel} className={buttonClasses({ variant: 'secondary', size: 'sm' })} aria-label={`Call ${who}`}>
          <Phone size={16} aria-hidden="true" />
          Call
        </a>
      ) : null}
      {sms ? (
        <a href={sms} className={buttonClasses({ variant: 'secondary', size: 'sm' })} aria-label={`Text ${who}`}>
          <MessageSquare size={16} aria-hidden="true" />
          Text
        </a>
      ) : null}
      {email ? (
        <a
          href={`mailto:${email}`}
          className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          aria-label={`Email ${who}`}
        >
          <Mail size={16} aria-hidden="true" />
          Email
        </a>
      ) : null}
    </div>
  )
}
