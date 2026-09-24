'use client'

import Link from 'next/link'
import { ArrowLeftRight, ClipboardList, Plus } from 'lucide-react'
import type { ScheduleDay } from '@/lib/schedule/effective'
import { formatDate } from '@/lib/sffd/dates'
import { buttonClasses, cn, Sheet } from '@/components/ui'
import { dayActions, describeDay, type DayAction, type DayContext } from './calendar-model'
import { LINE_DOT } from './tones'

export interface DaySheetProps {
  /** The day to show; null keeps the sheet closed. */
  day: ScheduleDay | null
  ctx: DayContext
  /** Shown when the data behind the sheet is an offline snapshot. */
  offline?: boolean
  onClose: () => void
}

const ACTION_ICON: Record<DayAction['kind'], typeof Plus> = {
  post: Plus,
  board: ClipboardList,
  trade: ArrowLeftRight,
}

/** Bottom sheet for a tapped day: plain-English status and what I can do about it. */
export function DaySheet({ day, ctx, offline = false, onClose }: DaySheetProps) {
  const lines = day ? describeDay(day, ctx) : []
  const actions = day ? dayActions(day, ctx) : []

  return (
    <Sheet
      open={day !== null}
      onClose={onClose}
      title={day ? formatDate(day.ymd, 'long') : ''}
      description={day?.isToday ? 'Today' : undefined}
      footer={
        actions.length ? (
          <div className="flex flex-col gap-2">
            {actions.map((action, i) => {
              const Icon = ACTION_ICON[action.kind]
              return (
                <Link
                  key={action.key}
                  href={action.href}
                  className={buttonClasses({ variant: i === 0 ? 'primary' : 'secondary', fullWidth: true })}
                >
                  <Icon size={18} aria-hidden="true" />
                  {action.label}
                </Link>
              )
            })}
          </div>
        ) : undefined
      }
    >
      <ul className="space-y-2 pb-1">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-3 rounded-xl border border-line bg-elevated px-3 py-3">
            <span aria-hidden="true" className={cn('mt-1.5 h-3 w-3 shrink-0 rounded-full', LINE_DOT[line.tone])} />
            <div className="min-w-0">
              <p className="text-[15px] leading-snug text-fg">{line.text}</p>
              {line.detail ? <p className="mt-0.5 text-sm text-fg-muted">{line.detail}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {offline ? (
        <p className="mt-2 text-sm text-fg-dim">You&apos;re seeing saved data. It may be out of date.</p>
      ) : null}
    </Sheet>
  )
}
