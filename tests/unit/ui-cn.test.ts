import { describe, expect, it } from 'vitest'
import { cn } from '@/components/ui/cn'

describe('cn (tailwind-merge: later classes win)', () => {
  it('joins and skips falsy values', () => {
    expect(cn('a', false, null, undefined, 0, '', 'b')).toBe('a b')
    expect(cn()).toBe('')
  })

  it('a caller can re-tint a Card (UX-12)', () => {
    expect(cn('rounded-2xl border border-line bg-card p-4', 'border-accent-yellow/40 bg-accent-yellow/[0.06]')).toBe(
      'rounded-2xl border p-4 border-accent-yellow/40 bg-accent-yellow/[0.06]',
    )
  })

  it('text colour and text size are separate groups', () => {
    expect(cn('text-sm text-fg-muted', 'text-accent-purple')).toBe('text-sm text-accent-purple')
    expect(cn('text-base', 'text-sm')).toBe('text-sm')
    expect(cn('text-[11px]', 'text-fg')).toBe('text-[11px] text-fg')
  })

  it('knows the app’s custom utilities', () => {
    expect(cn('font-display text-3xl', 'font-semibold')).toBe('font-display text-3xl font-semibold')
    expect(cn('font-display', 'font-sans')).toBe('font-sans')
    expect(cn('pb-nav', 'pb-8')).toBe('pb-8')
    expect(cn('px-4', 'px-safe')).toBe('px-safe')
    expect(cn('stagger-1', 'stagger-2')).toBe('stagger-2')
    expect(cn('glass-nav scrollbar-none', 'card-hover')).toBe('glass-nav scrollbar-none card-hover')
  })

  it('responsive variants only replace the same variant', () => {
    expect(cn('px-3 sm:px-4', 'px-2')).toBe('sm:px-4 px-2')
  })
})
