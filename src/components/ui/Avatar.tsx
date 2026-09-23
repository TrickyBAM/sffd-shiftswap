import { cn } from './cn'

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
} as const

// Accent text on a 12 % tint of itself keeps ≥ 4.5:1 against the dark card background.
const TINTS = [
  'bg-sffd-red/12 text-sffd-red-text',
  'bg-accent-orange/12 text-accent-orange',
  'bg-accent-blue/12 text-accent-blue',
  'bg-accent-purple/12 text-accent-purple',
  'bg-accent-green/12 text-accent-green',
  'bg-accent-yellow/12 text-accent-yellow',
] as const

/** "Brian Machado" → "BM"; "madonna" → "M"; "" → "?". */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

function tintFor(seed: string): string {
  // Small deterministic string hash so a member always gets the same color.
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return TINTS[Math.abs(hash) % TINTS.length]
}

export interface AvatarProps {
  name: string | null | undefined
  size?: keyof typeof SIZES
  /** Stable key for the color (e.g. the user id); defaults to the name. */
  colorKey?: string
  /**
   * Accessible name. Omit when the name is already shown next to the avatar
   * (the avatar is then hidden from screen readers).
   */
  label?: string
  className?: string
}

export function Avatar({ name, size = 'md', colorKey, label, className }: AvatarProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        SIZES[size],
        tintFor(colorKey ?? name ?? ''),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
