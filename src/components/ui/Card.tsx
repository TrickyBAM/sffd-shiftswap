import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

const PADDING = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5 md:p-6',
} as const

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li'
  padding?: keyof typeof PADDING
  /** Adds the hover lift used for tappable cards. */
  interactive?: boolean
}

export function Card({
  as: Tag = 'div',
  padding = 'md',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      {...rest}
      className={cn(
        'rounded-2xl border border-line bg-card',
        PADDING[padding],
        interactive && 'card-hover',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  /** Heading level for the title; defaults to h2. */
  level?: 2 | 3 | 4
  description?: ReactNode
  action?: ReactNode
  className?: string
}

/** Title row for a card: display-font heading, optional description and a trailing action. */
export function CardHeader({ title, level = 2, description, action, className }: CardHeaderProps) {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading className="font-display text-xl leading-tight text-fg">{title}</Heading>
        {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
