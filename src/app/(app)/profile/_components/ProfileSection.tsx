import type { ReactNode } from 'react'

/** A titled block on the Profile page: display-font h2 above a stack of cards. */
export function ProfileSection({
  id,
  title,
  description,
  children,
}: {
  /** Used for the heading id (aria-labelledby). */
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  const headingId = `${id}-title`
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="px-1">
        <h2 id={headingId} className="font-display text-2xl tracking-wide text-fg">
          {title}
        </h2>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
