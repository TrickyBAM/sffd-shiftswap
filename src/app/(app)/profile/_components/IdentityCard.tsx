'use client'

import { Pencil } from 'lucide-react'
import { Avatar, Badge, Button, Card } from '@/components/ui'
import { useProfile } from '@/components/providers/ProfileProvider'
import { locationLabels, tourLabel } from './profile-model'

/** Who I am: name, rank, station / battalion / division and tour. */
export function IdentityCard({ onEdit }: { onEdit: () => void }) {
  const { profile, isAdmin } = useProfile()
  const where = locationLabels(profile.station)
  const rows: { label: string; value: string }[] = [
    { label: 'Station', value: where?.station ?? 'Not set' },
    { label: 'Battalion', value: where?.battalion ?? '—' },
    { label: 'Division', value: where?.division ?? '—' },
    { label: 'Tour', value: tourLabel(profile.tour) },
  ]

  return (
    <Card as="section" aria-labelledby="profile-name" padding="lg">
      <div className="flex items-center gap-4">
        <Avatar name={profile.full_name} colorKey={profile.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 id="profile-name" className="truncate font-display text-3xl leading-none tracking-wide text-fg">
            {profile.full_name || 'Your profile'}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-fg-muted">{profile.rank ?? 'Rank not set'}</span>
            {isAdmin ? <Badge tone="blue">Admin</Badge> : null}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="rounded-xl bg-elevated px-3 py-2.5">
            <dt className="text-xs font-semibold uppercase tracking-wide text-fg-dim">{row.label}</dt>
            <dd className="mt-0.5 font-semibold text-fg">{row.value}</dd>
          </div>
        ))}
      </dl>

      <Button
        variant="secondary"
        fullWidth
        className="mt-4"
        onClick={onEdit}
        icon={<Pencil size={16} aria-hidden="true" />}
      >
        Edit my details
      </Button>
    </Card>
  )
}
