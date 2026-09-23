import { History } from 'lucide-react'
import { Badge, EmptyState, type BadgeTone } from '@/components/ui'
import { formatDate } from '@/lib/sffd/dates'
import { stationLabel } from '@/lib/sffd/stations'
import { TradeLinkCard, TradeSection } from './TradeLinkCard'
import type { HistoryItem, HistoryTone } from './trades-model'

const BADGE_TONES: Record<HistoryTone, BadgeTone> = {
  done: 'green',
  cancelled: 'gray',
  expired: 'gray',
  declined: 'neutral',
  withdrawn: 'neutral',
}

export function HistoryTab({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<History size={28} />}
        title="No history yet"
        description="Past trades, cancelled posts and requests that didn't work out will be listed here."
      />
    )
  }

  return (
    <TradeSection title="Past and closed" count={items.length}>
      {items.map((item) => (
        <li key={item.key}>
          <TradeLinkCard
            shiftId={item.shiftId}
            date={item.date}
            dateTone="dim"
            title={item.title}
            subtitle={`${formatDate(item.date, 'medium')} · ${item.shiftType} · ${stationLabel(item.station)}`}
          >
            <Badge tone={BADGE_TONES[item.tone]}>{item.badge}</Badge>
            {item.isSwap ? <Badge tone="purple">SwapMatch</Badge> : null}
            {item.detail ? <span className="w-full text-sm text-fg-dim">{item.detail}</span> : null}
          </TradeLinkCard>
        </li>
      ))}
    </TradeSection>
  )
}
