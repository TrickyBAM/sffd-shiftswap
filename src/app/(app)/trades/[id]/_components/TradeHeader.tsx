'use client'

import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/components/AppHeader'
import { HISTORY_BACK_LABEL, hasInAppHistory, readHistoryFacts, type BackTarget } from '../_lib/back-nav'

const noopSubscribe = () => () => {}
const inAppHistorySnapshot = () => hasInAppHistory(readHistoryFacts())
const serverSnapshot = () => false

export interface TradeHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Where the back arrow goes when there's no in-app page to go back to. */
  fallback: BackTarget
}

/**
 * The trade page's AppHeader. Its back arrow goes back in history when the
 * member got here inside the app (so Back from a trade opened on the November
 * calendar returns to November), else to `fallback`. The arrow stays a real
 * link to `fallback`, so it works before the page's scripts load and opens in
 * a new tab like any link.
 */
export function TradeHeader({ title, subtitle, fallback }: TradeHeaderProps) {
  const router = useRouter()
  // False while rendering on the server and hydrating, then the real answer.
  const inApp = useSyncExternalStore(noopSubscribe, inAppHistorySnapshot, serverSnapshot)
  const label = inApp ? HISTORY_BACK_LABEL : fallback.label

  // AppHeader renders the back arrow as a plain link; catch its click first
  // (capture phase) and go back instead. next/link skips its own navigation
  // when the click's default has been prevented.
  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!inApp || event.defaultPrevented) return
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target instanceof Element ? event.target : null
    const link = target?.closest('a')
    const header = link?.closest('header')
    if (!link || !header || header.querySelector('a') !== link || link.getAttribute('aria-label') !== label) return
    event.preventDefault()
    router.back()
  }

  return (
    // display: contents keeps the header's sticky positioning working.
    <div className="contents" onClickCapture={onClickCapture}>
      <AppHeader title={title} subtitle={subtitle} back={{ href: fallback.href, label }} />
    </div>
  )
}
