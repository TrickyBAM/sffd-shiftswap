'use client'

import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui'
import { plural, stationText, tourText } from '../../_lib/format'
import { rosterRowName, type RosterPreview } from '../_lib/preview'

/** How many good rows the preview table shows. */
const TABLE_LIMIT = 100

/** What the upload will do: the problem lines, then a table of the rows that will be imported. */
export function ImportPreview({ preview }: { preview: RosterPreview }) {
  const problems = preview.lines.filter((line) => line.error)
  const good = preview.lines.filter((line) => line.row)
  const shown = good.slice(0, TABLE_LIMIT)

  return (
    <div className="space-y-4">
      {problems.length > 0 ? (
        <section aria-labelledby="roster-problems-heading" className="rounded-2xl border border-accent-yellow/30 bg-accent-yellow/[0.06] p-4">
          <h3 id="roster-problems-heading" className="flex items-center gap-2 text-sm font-semibold text-fg">
            <AlertTriangle size={16} aria-hidden="true" className="text-accent-yellow" />
            {plural(problems.length, 'line')} with problems (skipped)
          </h3>
          <p className="mt-1 text-sm text-fg-muted">Fix these in your file and upload it again, or import the rest now.</p>
          <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto text-sm">
            {problems.map((line) => (
              <li key={line.line} className="flex gap-2">
                <span className="shrink-0 font-semibold text-fg">Line {line.line}:</span>
                <span className="text-fg-muted">{line.error}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="roster-ready-heading">
        <h3 id="roster-ready-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <CheckCircle2 size={16} aria-hidden="true" className="text-accent-green" />
          {good.length ? `Ready to import: ${plural(good.length, 'person', 'people')}` : 'Nothing to import yet'}
        </h3>
        {good.length > 0 ? (
          <Card padding="none" className="overflow-hidden">
            <div className="max-h-96 overflow-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Roster rows that will be imported</caption>
                <thead className="sticky top-0 bg-elevated text-xs text-fg-dim">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Line</th>
                    <th scope="col" className="px-3 py-2 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Employee ID</th>
                    <th scope="col" className="px-3 py-2 font-medium">Rank</th>
                    <th scope="col" className="px-3 py-2 font-medium">Station</th>
                    <th scope="col" className="px-3 py-2 font-medium">Tour</th>
                    <th scope="col" className="px-3 py-2 font-medium">Email</th>
                    <th scope="col" className="px-3 py-2 font-medium">Phone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {shown.map(({ line, row }) =>
                    row ? (
                      <tr key={line}>
                        <td className="px-3 py-2 text-fg-dim">{line}</td>
                        <td className="px-3 py-2 font-medium text-fg">{rosterRowName(row)}</td>
                        <td className="px-3 py-2 text-fg-muted">{row.employee_id ?? '—'}</td>
                        <td className="px-3 py-2 text-fg-muted">{row.rank ?? '—'}</td>
                        <td className="px-3 py-2 text-fg-muted">
                          {typeof row.station === 'number' ? stationText(row.station) : '—'}
                        </td>
                        <td className="px-3 py-2 text-fg-muted">
                          {typeof row.tour === 'number' ? tourText(row.tour) : '—'}
                        </td>
                        <td className="px-3 py-2 text-fg-muted">{row.email ?? '—'}</td>
                        <td className="px-3 py-2 text-fg-muted">{row.phone ?? '—'}</td>
                      </tr>
                    ) : null,
                  )}
                </tbody>
              </table>
            </div>
            {good.length > shown.length ? (
              <p className="border-t border-line px-3 py-2 text-xs text-fg-dim">
                Showing the first {shown.length} of {good.length.toLocaleString('en-US')}. All of them will be imported.
              </p>
            ) : null}
          </Card>
        ) : null}
      </section>
    </div>
  )
}
