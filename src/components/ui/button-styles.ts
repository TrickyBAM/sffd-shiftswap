import { cn } from './cn'

// Kept separate from Button.tsx (a Client Component) so Server Components can call
// buttonClasses() to style a <Link> like a button.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ' +
  'aria-busy:cursor-progress'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-sffd-red text-white shadow-[0_4px_20px_rgba(211,47,47,0.3)] ' +
    'hover:bg-sffd-red-dark active:bg-sffd-red-dark',
  secondary: 'border border-line-strong bg-elevated text-fg hover:bg-raised active:bg-raised',
  ghost: 'bg-transparent text-fg-muted hover:bg-white/[0.06] hover:text-fg active:bg-white/[0.08]',
  danger:
    'border border-sffd-red/60 bg-sffd-red/10 text-sffd-red-text ' +
    'hover:bg-sffd-red/20 active:bg-sffd-red/25',
}

// Every size keeps a 44 px minimum touch target (ARCHITECTURE §7.2).
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-12 px-4 text-[15px]',
  lg: 'min-h-14 px-6 text-base',
  icon: 'h-11 w-11 shrink-0 p-0',
}

export interface ButtonStyleOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
}

/** Button classes, for styling a `<Link>` or `<a>` like a button. */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)
}
