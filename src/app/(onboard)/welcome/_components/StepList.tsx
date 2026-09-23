import { Check } from 'lucide-react'
import { cn } from '@/components/ui/cn'

export type WelcomeStep = 1 | 2 | 3

const STEPS: ReadonlyArray<{ step: WelcomeStep; label: string }> = [
  { step: 1, label: 'TeleStaff notice' },
  { step: 2, label: 'Install the app' },
  { step: 3, label: 'Turn on alerts' },
]

export interface StepListProps {
  current: WelcomeStep
  /** Step 1 counts as done once acknowledged, even when showing it again. */
  acknowledged: boolean
}

/** "1 · 2 · 3" progress for the welcome steps. */
export function StepList({ current, acknowledged }: StepListProps) {
  return (
    <ol aria-label="Welcome steps" className="grid grid-cols-3 gap-2">
      {STEPS.map(({ step, label }) => {
        const active = step === current
        const done = step === 1 ? acknowledged && !active : step < current
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center text-xs',
              active ? 'border-sffd-red/50 bg-sffd-red/10 text-fg' : 'border-line bg-card text-fg-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                done ? 'bg-accent-green text-on-accent' : active ? 'bg-sffd-red text-white' : 'bg-raised text-fg-muted',
              )}
            >
              {done ? <Check size={14} /> : step}
            </span>
            <span>
              {label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
