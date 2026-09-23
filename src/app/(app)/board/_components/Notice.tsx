import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/components/ui'

const NOTICE_TONES = {
  info: { icon: Info, box: 'border-accent-blue/30 bg-accent-blue/[0.07]', iconClass: 'text-accent-blue' },
  success: { icon: CheckCircle2, box: 'border-accent-green/30 bg-accent-green/[0.07]', iconClass: 'text-accent-green' },
  warning: { icon: AlertCircle, box: 'border-accent-yellow/30 bg-accent-yellow/[0.07]', iconClass: 'text-accent-yellow' },
  danger: { icon: AlertCircle, box: 'border-sffd-red/30 bg-sffd-red/[0.07]', iconClass: 'text-sffd-red-text' },
} as const

export type NoticeTone = keyof typeof NOTICE_TONES

export interface NoticeProps {
  tone: NoticeTone
  title: ReactNode
  children?: ReactNode
  /** Buttons under the text. */
  actions?: ReactNode
  className?: string
}

/** A tinted box with an icon, a title, text and optional actions. */
export function Notice({ tone, title, children, actions, className }: NoticeProps) {
  const t = NOTICE_TONES[tone]
  const Icon = t.icon
  return (
    <div className={cn('rounded-2xl border p-4', t.box, className)}>
      <p className="flex items-start gap-2 font-semibold text-fg">
        <Icon size={18} aria-hidden="true" className={cn('mt-0.5 shrink-0', t.iconClass)} />
        <span className="min-w-0">{title}</span>
      </p>
      {children ? <div className="mt-1.5 text-sm text-fg-muted">{children}</div> : null}
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
