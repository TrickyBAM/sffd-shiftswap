'use client'

import {
  createContext,
  useContext,
  useId,
  type KeyboardEvent,
  type ReactNode,
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
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'scrollbar-none flex gap-1 overflow-x-auto rounded-2xl border border-line bg-card p-1',
        className,
      )}
    >
      {children}
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
        'inline-flex min-h-11 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition-colors',
        selected ? 'bg-sffd-red text-white' : 'text-fg-muted hover:bg-white/[0.05] hover:text-fg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
      {count && count > 0 ? (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
            selected ? 'bg-white/25 text-white' : 'bg-sffd-red text-white',
          )}
        >
          {count > 99 ? '99+' : count}
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

/** Segmented navigation between sibling routes (e.g. the /admin sections). */
export function LinkTabs({ label, items, activeHref, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cn('scrollbar-none overflow-x-auto', className)}>
      <ul className="flex gap-1 rounded-2xl border border-line bg-card p-1">
        {items.map((item) => {
          const active = item.href === activeHref
          return (
            <li key={item.href} className="flex-1 shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition-colors',
                  active ? 'bg-sffd-red text-white' : 'text-fg-muted hover:bg-white/[0.05] hover:text-fg',
                )}
              >
                {item.label}
                {item.count && item.count > 0 ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px] font-bold">
                    {item.count > 99 ? '99+' : item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
