'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from './cn'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface ToastOptions {
  title: string
  description?: string
  tone?: ToastTone
  action?: { label: string; onClick: () => void }
  /**
   * Auto-dismiss after this many ms; 0 keeps it until dismissed.
   * Defaults: 4 s (info/success), 6 s (warning/error), sticky when there is an action.
   */
  duration?: number
  /** Re-using an id replaces the existing toast instead of stacking a duplicate. */
  id?: string
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'tone' | 'duration' | 'id'>> {
  description?: string
  action?: ToastOptions['action']
}

export interface ToastApi {
  show: (options: ToastOptions) => string
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  info: (title: string, description?: string) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const MAX_VISIBLE = 3
let toastCounter = 0

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-accent-blue' },
  success: { icon: CheckCircle2, className: 'text-accent-green' },
  warning: { icon: AlertTriangle, className: 'text-accent-yellow' },
  error: { icon: XCircle, className: 'text-sffd-red-text' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((options: ToastOptions) => {
    const tone = options.tone ?? 'info'
    const id = options.id ?? `toast-${++toastCounter}`
    const duration =
      options.duration ?? (options.action ? 0 : tone === 'error' || tone === 'warning' ? 6000 : 4000)
    const item: ToastItem = {
      id,
      tone,
      duration,
      title: options.title,
      description: options.description,
      action: options.action,
    }
    setToasts((list) => {
      const rest = list.filter((t) => t.id !== id)
      return [...rest, item].slice(-MAX_VISIBLE)
    })
    return id
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, description) => show({ title, description, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'error' }),
      info: (title, description) => show({ title, description, tone: 'info' }),
    }),
    [show, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/*
        The live region is always in the DOM so screen readers register it before the
        first toast appears. Polite: announcements wait for the user to finish.
      */}
      <div
        data-toast-region=""
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4 pt-[calc(var(--safe-top)+0.75rem)]"
      >
        <div aria-live="polite" aria-relevant="additions text" className="flex w-full flex-col items-center gap-2">
          {toasts.map((toast) => (
            <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const { icon: Icon, className } = TONE_STYLES[toast.tone]
  const [paused, setPaused] = useState(false)
  const remaining = useRef(toast.duration)

  // Auto-dismiss, pausing while hovered or focused (WCAG 2.2.1 timing).
  useEffect(() => {
    if (toast.duration <= 0 || paused) return
    const started = Date.now()
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started))
    }
  }, [toast.id, toast.duration, paused, onDismiss])

  return (
    // No role here: the parent aria-live region announces each added toast once
    // (nesting role=status/alert inside it would announce twice).
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="animate-toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-line-strong bg-elevated/95 p-3 pl-4 shadow-2xl backdrop-blur-md"
    >
      <Icon size={20} aria-hidden="true" className={cn('mt-0.5 shrink-0', className)} />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm font-semibold text-fg">{toast.title}</p>
        {toast.description ? <p className="mt-0.5 text-sm text-fg-muted">{toast.description}</p> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
          className="min-h-11 shrink-0 rounded-xl bg-white/[0.08] px-3 text-sm font-semibold text-fg hover:bg-white/[0.14]"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-my-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg-dim hover:bg-white/[0.06] hover:text-fg"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

/** Toast API: `const toast = useToast(); toast.success('Request sent')`. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider> (it is in the root layout).')
  return ctx
}
