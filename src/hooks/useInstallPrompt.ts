'use client'

import { useCallback, useSyncExternalStore } from 'react'

/** Chrome/Edge/Samsung Internet's install event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface InstallSnapshot {
  /** Android/desktop Chromium offered an install prompt we can show on a button tap. */
  canPrompt: boolean
  /** The app was installed during this page session. */
  installed: boolean
}

// Module-level store: `beforeinstallprompt` fires once, early, often before the screen
// that shows the Install button has mounted, so PWARegister starts listening at boot.
let deferredPrompt: BeforeInstallPromptEvent | null = null
let snapshot: InstallSnapshot = { canPrompt: false, installed: false }
const SERVER_SNAPSHOT: InstallSnapshot = { canPrompt: false, installed: false }
const listeners = new Set<() => void>()
let capturing = false

function update(next: Partial<InstallSnapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((listener) => listener())
}

/** Start listening for the install events. Safe to call repeatedly. */
export function captureInstallPrompt(): void {
  if (capturing || typeof window === 'undefined') return
  capturing = true
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the event so we can show the prompt from our own button later.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    update({ canPrompt: true })
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    update({ canPrompt: false, installed: true })
  })
}

function subscribe(listener: () => void) {
  captureInstallPrompt()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

export function useInstallPrompt(): InstallSnapshot & { promptInstall: () => Promise<InstallOutcome> } {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  )

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const event = deferredPrompt
    if (!event) return 'unavailable'
    // A deferred prompt can only be used once.
    deferredPrompt = null
    update({ canPrompt: false })
    try {
      await event.prompt()
      const choice = await event.userChoice
      if (choice.outcome === 'accepted') update({ installed: true })
      return choice.outcome
    } catch {
      return 'unavailable'
    }
  }, [])

  return { ...state, promptInstall }
}
