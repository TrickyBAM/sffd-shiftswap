'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import Link from 'next/link'
import { cn } from './cn'

interface TabsContextValue {
  baseId: string
  value: string
  setValue: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabs(component: string): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error(`<${component}> must be inside <Tabs>.`)
  return ctx
}

const tabId = (base: string, value: string) => `${base}-tab-${value}`
const panelId = (base: string, value: string) => `${base}-panel-${value}`

// Sizing (UX-08): four tabs with count bubbles fit a 375 px phone (tight
// padding and 13 px labels below `sm`); more than fit (the five admin
// sections) scroll sideways with a fade at the edge that has more.
const TAB_BASE =
  'inline-flex min-h-11 flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1.5 text-[13px] font-semibold transition-colors sm:gap-1.5 sm:px-3 sm:text-sm'
const TAB_SELECTED = 'bg-sffd-red text-white'
const TAB_IDLE = 'text-fg-muted hover:bg-white/[0.05] hover:text-fg'
const COUNT_BUBBLE =
  'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-[11px]'

function countText(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/**
 * Horizontal overflow state of a scroll container, and keeping the selected
 * item in view. Re-measured on scroll and resize.
 */
function useScrollEdges(ref: RefObject<HTMLElement | null>, selectedKey: string, selector: string) {
  const [edges, setEdges] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const start = el.scrollLeft > 1
    const end = max - el.scrollLeft > 1
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, measure])

  // Scroll the selected tab into view (only this list, never the page).
  const firstRun = useRef(true)
  useEffect(() => {
    const list = ref.current
    const item = list?.querySelector<HTMLElement>(selector)
    if (!list || !item) return
    const pad = 24
    // Position of the item inside the scrolled content, whatever the current scroll.
    const left = item.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft
    const right = left + item.getBoundingClientRect().width
    let target: number | null = null
    if (left - pad < list.scrollLeft) target = Math.max(0, left - pad)
    else if (right + pad > list.scrollLeft + list.clientWidth) target = right + pad - list.clientWidth
    if (target !== null) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      list.scrollTo({ left: target, behavior: firstRun.current || reduce ? 'auto' : 'smooth' })
    }
    firstRun.current = false
    measure()
  }, [ref, selector, selectedKey, measure])

  return edges
}

/** Fades over the edge(s) of a scrolling tab strip that have more tabs. */
function EdgeFades({ start, end }: { start: boolean; end: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-px left-px w-8 rounded-l-2xl bg-linear-to-r from-card to-transparent transition-opacity',
          start ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-px right-px w-8 rounded-r-2xl bg-linear-to-l from-card to-transparent transition-opacity',
          end ? 'opacity-100' : 'opacity-0',
        )}
      />
    </>
  )
}

export interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  className?: string
  children: ReactNode
}

/**
 * Accessible tabs (WAI-ARIA tabs pattern, automatic activation):
 *
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <TabList label="Trades">
 *       <Tab value="pending" count={3}>Pending</Tab>
 *       <Tab value="confirmed">Confirmed</Tab>
 *     </TabList>
 *     <TabPanel value="pending">…</TabPanel>
 *     <TabPanel value="confirmed">…</TabPanel>
 *   </Tabs>
 *
 * Arrow keys move between tabs, Home/End jump to the ends. For tabs that are separate
 * routes, use <LinkTabs> instead (links with aria-current, not a tablist).
 */
export function Tabs({ value, onValueChange, className, children }: TabsProps) {
  const baseId = useId()
  return (
    <TabsContext.Provider value={{ baseId, value, setValue: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export interface TabListProps {
  /** Accessible name of the tab list. */
  label: string
  className?: string
  children: ReactNode
}

export function TabList({ label, className, children }: TabListProps) {
  const { value } = useTabs('TabList')
  const listRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(listRef, value, '[role="tab"][aria-selected="true"]')

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
    )
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (current < 0) return
    let next = -1
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next < 0) return
    event.preventDefault()
    tabs[next].focus()
    tabs[next].click()
  }

  return (
    <div className={cn('relative', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="scrollbar-none flex gap-0.5 overflow-x-auto overscroll-x-contain rounded-2xl border border-line bg-card p-1 sm:gap-1"
      >
        {children}
      </div>
      <EdgeFades start={edges.start} end={edges.end} />
    </div>
  )
}

export interface TabProps {
  value: string
  /** Small count bubble after the label (0 hides it). */
  count?: number
  disabled?: boolean
  className?: string
  children: ReactNode
}

export function Tab({ value, count, disabled = false, className, children }: TabProps) {
  const { baseId, value: selectedValue, setValue } = useTabs('Tab')
  const selected = value === selectedValue
  return (
    <button
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      aria-selected={selected}
      aria-controls={panelId(baseId, value)}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        TAB_BASE,
        selected ? TAB_SELECTED : TAB_IDLE,
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
      {count && count > 0 ? (
        <span className={cn(COUNT_BUBBLE, selected ? 'bg-white/25 text-white' : 'bg-sffd-red text-white')}>
          {countText(count)}
        </span>
      ) : null}
    </button>
  )
}

export interface TabPanelProps {
  value: string
  className?: string
  /** Keep the panel mounted (hidden) when inactive, preserving its state. Default false. */
  keepMounted?: boolean
  children: ReactNode
}

export function TabPanel({ value, className, keepMounted = false, children }: TabPanelProps) {
  const { baseId, value: selectedValue } = useTabs('TabPanel')
  const selected = value === selectedValue
  if (!selected && !keepMounted) return null
  return (
    <div
      role="tabpanel"
      id={panelId(baseId, value)}
      aria-labelledby={tabId(baseId, value)}
      hidden={!selected}
      tabIndex={0}
      className={cn('mt-4 focus-visible:outline-offset-4', className)}
    >
      {children}
    </div>
  )
}

export interface LinkTabsProps {
  /** Accessible name for the navigation landmark. */
  label: string
  items: ReadonlyArray<{ href: string; label: string; count?: number }>
  /** The href that is currently active. */
  activeHref: string
  className?: string
}

/**
 * Segmented navigation between sibling routes (e.g. the /admin sections).
 * Scrolls sideways when the items don't fit, with an edge fade and the active
 * item kept in view.
 */
export function LinkTabs({ label, items, activeHref, className }: LinkTabsProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const edges = useScrollEdges(listRef, activeHref, '[aria-current="page"]')

  return (
    <nav aria-label={label} className={cn('relative', className)}>
      <ul
        ref={listRef}
        className="scrollbar-none flex gap-0.5 overflow-x-auto overscroll-x-contain rounded-2xl border border-line bg-card p-1 sm:gap-1"
      >
        {items.map((item) => {
          const active = item.href === activeHref
          return (
            <li key={item.href} className="flex flex-1 shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(TAB_BASE, 'w-full', active ? TAB_SELECTED : TAB_IDLE)}
              >
                {item.label}
                {item.count && item.count > 0 ? (
                  <span className={cn(COUNT_BUBBLE, 'bg-white/20')}>{countText(item.count)}</span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
      <EdgeFades start={edges.start} end={edges.end} />
    </nav>
  )
}
