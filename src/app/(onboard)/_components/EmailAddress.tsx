import { Fragment } from 'react'
import { cn } from '@/components/ui/cn'

/**
 * Splits an email address where a line may break: after the "@" and before
 * each ".". "pat.lee@sfgov.org" → ["pat", ".lee@", "sfgov", ".org"].
 * (A loop, not a lookbehind regex: older iPhones can't parse those.)
 */
export function emailBreakPieces(email: string): string[] {
  const pieces: string[] = []
  let current = ''
  for (const ch of email) {
    if (ch === '.' && current) {
      pieces.push(current)
      current = ''
    }
    current += ch
    if (ch === '@') {
      pieces.push(current)
      current = ''
    }
  }
  if (current) pieces.push(current)
  return pieces
}

export interface EmailAddressProps {
  email: string
  className?: string
}

/**
 * An email address that wraps cleanly on a narrow phone: at the "@" or a ".",
 * never in the middle of a word — unless one piece is wider than the screen
 * on its own, where overflow-wrap: anywhere is the last resort.
 */
export function EmailAddress({ email, className }: EmailAddressProps) {
  return (
    <span className={cn('wrap-anywhere', className)}>
      {emailBreakPieces(email).map((piece, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {piece}
        </Fragment>
      ))}
    </span>
  )
}
