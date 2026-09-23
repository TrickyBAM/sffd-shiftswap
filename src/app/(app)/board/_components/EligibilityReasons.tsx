import Link from 'next/link'
import type { EligibilityReason } from '@/lib/types/database'
import { Notice } from './Notice'

/** Why I can't request a shift: one plain-English line per failed rule. */
export function EligibilityReasons({ reasons }: { reasons: readonly EligibilityReason[] }) {
  return (
    <Notice tone="warning" title="You can't request this shift">
      {reasons.length === 0 ? (
        <p>It isn&apos;t available to you right now.</p>
      ) : (
        <ul className="space-y-1.5">
          {reasons.map((r, i) => (
            <li key={`${r.code}-${i}`} className="flex gap-2">
              <span aria-hidden="true" className="text-fg-dim">
                •
              </span>
              <span>
                {r.message}
                {r.code === 'ACK_REQUIRED' ? (
                  <>
                    {' '}
                    <Link
                      href="/welcome"
                      className="font-semibold text-accent-blue underline-offset-2 hover:underline"
                    >
                      Read the notice
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Notice>
  )
}
