'use client'

import { CheckCircle2 } from 'lucide-react'
import { Button, Card } from '@/components/ui'
import type { ImportRosterResult } from '@/lib/types/database'
import { importErrorsWithLines } from '../_lib/preview'

export interface ImportResultProps {
  result: ImportRosterResult
  /** File line of each row that was sent (to explain row errors). */
  rowLines: readonly number[]
  /** Lines the preview had already skipped. */
  skippedInPreview: number
  replaced: boolean
  onDone: () => void
}

/** Summary after an import: added, updated, unchanged, removed and any rows the database refused. */
export function ImportResult({ result, rowLines, skippedInPreview, replaced, onDone }: ImportResultProps) {
  const errors = importErrorsWithLines(result.errors, rowLines)
  const stats: { label: string; value: number }[] = [
    { label: 'Added', value: result.inserted },
    { label: 'Updated', value: result.updated },
    { label: 'Already up to date', value: result.skipped },
    ...(replaced ? [{ label: 'Old unclaimed entries removed', value: result.deleted }] : []),
    { label: 'Not imported', value: errors.length + skippedInPreview },
  ]

  return (
    <Card as="section" aria-labelledby="roster-result-heading" className="space-y-4">
      <h3 id="roster-result-heading" className="flex items-center gap-2 font-display text-xl text-fg">
        <CheckCircle2 size={20} aria-hidden="true" className="text-accent-green" />
        Roster imported
      </h3>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-line bg-elevated/60 px-3 py-2">
            <dt className="text-xs text-fg-dim">{stat.label}</dt>
            <dd className="font-display text-2xl leading-tight text-fg">{stat.value.toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>
      {errors.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-fg">The database refused these rows:</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
            {errors.map((error, index) => (
              <li key={index} className="text-fg-muted">
                <span className="font-semibold text-fg">{error.line ? `Line ${error.line}: ` : ''}</span>
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button variant="secondary" onClick={onDone}>
        Upload another file
      </Button>
    </Card>
  )
}
