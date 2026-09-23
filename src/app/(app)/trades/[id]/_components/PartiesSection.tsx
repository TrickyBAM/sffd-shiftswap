import Link from 'next/link'
import { ArrowRight, Repeat2 } from 'lucide-react'
import { Avatar, Card, CardHeader, buttonClasses } from '@/components/ui'
import { formatDate } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import type { Shift } from '@/lib/types/database'
import { personInfo, type Legs, type PeopleLookup, type PersonInfo } from '../_lib/trade-model'

export interface PartiesSectionProps {
  legs: Legs
  lookup: PeopleLookup
}

function nameOrYou(id: string | null, name: string, me: string, capital = false): string {
  if (id !== me) return name
  return capital ? 'You' : 'you'
}

/** Who owns the shift and who works it, plus the other SwapMatch leg. */
export function PartiesSection({ legs, lookup }: PartiesSectionProps) {
  const { viewed, other, viewingReturnLeg } = legs
  const me = lookup.me
  const poster = personInfo(viewed.poster_id, viewed.poster_name, viewed.rank, lookup)
  const coverer = viewed.coverer_id
    ? personInfo(viewed.coverer_id, viewed.coverer_name ?? 'Another member', viewed.rank, lookup)
    : null

  const sentence = coverer
    ? `${nameOrYou(viewed.coverer_id, coverer.name, me, true)} ${viewed.coverer_id === me ? 'work' : 'works'} this shift for ${nameOrYou(viewed.poster_id, poster.name, me)}.`
    : null

  return (
    <Card as="section" aria-labelledby="trade-parties-title">
      <CardHeader title={<span id="trade-parties-title">Who&apos;s involved</span>} description={sentence ?? undefined} />
      <ul className="space-y-3">
        <PersonRow
          label={viewed.status === 'open' ? 'Posted by' : 'Shift belongs to'}
          person={poster}
          colorKey={viewed.poster_id}
          isMe={viewed.poster_id === me}
        />
        {coverer ? (
          <PersonRow label="Working it" person={coverer} colorKey={viewed.coverer_id ?? ''} isMe={viewed.coverer_id === me} />
        ) : (
          <li className="flex min-h-11 items-center gap-3 text-sm text-fg-muted">
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong"
            >
              ?
            </span>
            <span>
              <span className="block text-xs uppercase tracking-wide text-fg-dim">Working it</span>
              {viewed.status === 'open'
                ? 'Nobody yet'
                : viewed.status === 'cancelled'
                  ? `Nobody. It stays with ${nameOrYou(viewed.poster_id, poster.name, me)}.`
                  : 'Nobody'}
            </span>
          </li>
        )}
      </ul>

      {other ? <OtherLeg leg={other} isReturnLeg={!viewingReturnLeg} me={me} /> : null}
    </Card>
  )
}

function PersonRow({ label, person, colorKey, isMe }: { label: string; person: PersonInfo; colorKey: string; isMe: boolean }) {
  const extras = [person.rank, person.station != null ? stationLabel(person.station) : null].filter(Boolean).join(' · ')
  return (
    <li className="flex min-h-11 items-center gap-3">
      <Avatar name={person.name} colorKey={colorKey} />
      <span className="min-w-0 text-sm">
        <span className="block text-xs uppercase tracking-wide text-fg-dim">{label}</span>
        <span className="font-semibold text-fg">
          {person.name}
          {isMe ? <span className="font-normal text-fg-muted"> (you)</span> : null}
        </span>
        {extras ? <span className="block text-fg-muted">{extras}</span> : null}
      </span>
    </li>
  )
}

/** The other SwapMatch leg: its date, who works it, and a link to it. */
function OtherLeg({ leg, isReturnLeg, me }: { leg: Shift; isReturnLeg: boolean; me: string }) {
  const worker = nameOrYou(leg.coverer_id, leg.coverer_name ?? 'Another member', me, true)
  const owner = leg.poster_id === me ? 'your' : `${leg.poster_name}'s`
  const verb = leg.coverer_id === me ? 'work' : 'works'
  const what =
    leg.status === 'cancelled'
      ? `cancelled — it was ${owner} shift.`
      : leg.status === 'open' || !leg.coverer_id
        ? `${owner === 'your' ? 'Your' : `${leg.poster_name}'s`} shift, open again — nobody is covering it.`
        : `${worker} ${verb} ${owner} shift.`
  return (
    <div className="mt-4 rounded-xl border border-accent-purple/30 bg-accent-purple/[0.07] p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Repeat2 size={16} aria-hidden="true" className="shrink-0 text-accent-purple" />
        {isReturnLeg ? 'SwapMatch return shift' : 'SwapMatch: the first shift'}
      </p>
      <p className="mt-1 text-sm text-fg-muted">
        <span className="font-medium text-fg">{formatDate(leg.date, 'weekday')}</span> ({leg.shift_type}, {stationLabel(leg.station)}):{' '}
        {what}
      </p>
      <Link
        href={`/trades/${leg.id}`}
        className={buttonClasses({ variant: 'ghost', size: 'sm', className: '-ml-3 mt-1 text-accent-purple' })}
      >
        View the {formatDate(leg.date, 'short')} shift
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  )
}
