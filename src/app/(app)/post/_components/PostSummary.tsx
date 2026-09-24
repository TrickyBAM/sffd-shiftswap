import { Card, CardHeader, cn } from '@/components/ui'
import type { SummaryRow } from './post-model'

export interface PostSummaryProps {
  rows: readonly SummaryRow[]
  className?: string
}

/** Live "Here's what you're posting" card, updated as the form changes. */
export function PostSummary({ rows, className }: PostSummaryProps) {
  return (
    <Card as="section" aria-labelledby="post-summary-title" className={cn('border-line-strong', className)}>
      <CardHeader title={<span id="post-summary-title">Your post</span>} />
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-fg-dim">{row.label}</dt>
            <dd className={cn('mt-0.5 text-[15px] leading-snug', row.missing ? 'italic text-fg-muted' : 'text-fg')}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-line pt-3 text-sm text-fg-muted">
        ShiftSwap only helps you find someone. Once a trade is confirmed, it still needs approval in TeleStaff.
      </p>
    </Card>
  )
}
