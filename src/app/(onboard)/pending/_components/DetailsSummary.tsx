import { Card, CardHeader } from '@/components/ui/Card'
import { stationPathLabel } from '@/lib/sffd/stations'
import type { Profile } from '@/lib/types/database'

export interface DetailsSummaryProps {
  profile: Pick<Profile, 'full_name' | 'rank' | 'station' | 'tour' | 'phone' | 'employee_id'>
}

/** What the member sent for review, so they can spot a mistake and fix it. */
export function DetailsSummary({ profile }: DetailsSummaryProps) {
  const rows: Array<[string, string]> = [
    ['Name', profile.full_name || '—'],
    ['Rank', profile.rank ?? '—'],
    ['Station', profile.station !== null ? stationPathLabel(profile.station) : '—'],
    ['Tour', profile.tour !== null ? `Tour ${profile.tour}` : 'No tour'],
    ['Phone', profile.phone ?? '—'],
    ['Employee ID', profile.employee_id ?? 'Not given'],
  ]

  return (
    <Card as="section" aria-labelledby="details-title">
      <CardHeader
        title={<span id="details-title">What you sent</span>}
        description="A mistake here can stop the automatic roster match."
      />
      <dl className="divide-y divide-line text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-fg-dim">{label}</dt>
            <dd className="min-w-0 break-words text-right text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
