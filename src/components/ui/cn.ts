import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge that also knows this app's custom utilities (globals.css):
 * `font-display`, the safe-area paddings (`pt-safe`, `px-safe`, `pb-nav`, …),
 * `bottom-nav` and the `stagger-*` delays.
 */
const twMerge = extendTailwindMerge<'stagger'>({
  extend: {
    classGroups: {
      'font-family': [{ font: ['display'] }],
      pt: [{ pt: ['safe'] }],
      pb: [{ pb: ['safe', 'safe-sheet', 'nav'] }],
      pl: [{ pl: ['safe'] }],
      pr: [{ pr: ['safe'] }],
      px: [{ px: ['safe'] }],
      mb: [{ mb: ['safe'] }],
      bottom: [{ bottom: ['nav'] }],
      stagger: [{ stagger: ['1', '2', '3', '4'] }],
    },
  },
})

export type ClassValue = string | false | null | undefined | 0

/**
 * Joins class names, skipping falsy values, and resolves Tailwind conflicts so
 * the LAST class wins: `cn('bg-card p-4', 'bg-accent-blue/10 p-2')` →
 * `'bg-accent-blue/10 p-2'`. Components put their own classes first and the
 * caller's `className` last, so callers can override (e.g. tint a Card).
 */
export function cn(...parts: ClassValue[]): string {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    out = out ? `${out} ${part}` : part
  }
  return twMerge(out)
}
