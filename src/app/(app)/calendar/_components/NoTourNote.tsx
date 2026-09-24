'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Info, X } from 'lucide-react'
import { Button, cn } from '@/components/ui'

// "No tour" is a real answer (relief, detail, 40-hour), not missing data
// (UX-14). The note says what the calendar shows for them and can be hidden;
// the choice is remembered on this device for this member only.

/** localStorage key; the value is the id of the member who hid the note. */
export const NO_TOUR_NOTE_HIDDEN_KEY = 'shiftswap:calendar:no-tour-note-hidden'

const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function readHiddenFor(): string | null {
  try {
    return window.localStorage.getItem(NO_TOUR_NOTE_HIDDEN_KEY)
  } catch {
    return null
  }
}

function rememberHidden(userId: string): void {
  try {
    window.localStorage.setItem(NO_TOUR_NOTE_HIDDEN_KEY, userId)
  } catch {
    // Storage blocked: hidden until the page is reloaded.
  }
  for (const listener of listeners) listener()
}

export interface NoTourNoteProps {
  userId: string
  className?: string
}

/** Calendar note for members set to "No tour", with a way to hide it. */
export function NoTourNote({ userId, className }: NoTourNoteProps) {
  // Hidden while rendering on the server, so a member who hid it never sees it flash.
  const hiddenFor = useSyncExternalStore(subscribe, readHiddenFor, () => userId)
  const [hiddenNow, setHiddenNow] = useState(false)
  if (hiddenNow || hiddenFor === userId) return null

  const hide = () => {
    setHiddenNow(true)
    rememberHidden(userId)
  }

  return (
    <section
      aria-labelledby="no-tour-note-title"
      className={cn('rounded-2xl border border-accent-blue/25 bg-accent-blue/[0.06] p-4', className)}
    >
      <div className="flex items-start gap-3">
        <Info size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-blue" />
        <div className="min-w-0 flex-1">
          <h2 id="no-tour-note-title" className="font-semibold text-fg">
            You&apos;re set as No tour
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Your calendar shows your posts and trades. Tap any day to post a shift or see open shifts. If you&apos;re on
            a numbered tour, add it in Profile to see your regular schedule.
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide this note"
          className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg-dim hover:bg-white/[0.06] hover:text-fg"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-8">
        <Link
          href="/profile"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-blue hover:underline"
        >
          Add a tour in Profile
        </Link>
        <Button variant="ghost" size="sm" onClick={hide}>
          Got it
        </Button>
      </div>
    </section>
  )
}
