import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

/** A form-level error (e.g. the database's friendly message), announced right away. */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-sffd-red/30 bg-sffd-red/[0.08] p-3 text-sm text-fg"
    >
      <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-sffd-red-text" />
      <p className="min-w-0">{children}</p>
    </div>
  )
}
