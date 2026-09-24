'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useFieldControl } from '@/components/ui/Field'
import { Input, type InputProps } from '@/components/ui/Input'
import { cn } from '@/components/ui/cn'

export type PasswordInputProps = Omit<InputProps, 'type'>

/**
 * Password box with a show/hide toggle: a 44 px button inside the field. The
 * button keeps one name ("Show password") and reports its state with
 * aria-pressed, the toggle-button pattern screen readers announce as
 * "Show password, toggle button, pressed". The password is hidden again when
 * its form is submitted, so it isn't left on screen and password managers see
 * a password field.
 *
 * Use inside a <Field>; works with react-hook-form's register(). Pass
 * `autoComplete` ("current-password" / "new-password") and, for new
 * passwords, `maxLength={PASSWORD_MAX}` from '@/lib/validation'.
 */
export function PasswordInput({ className, id, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const field = useFieldControl()
  const inputId = id ?? field?.id
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const form = wrapperRef.current?.querySelector('input')?.form
    if (!form) return
    const hide = () => setVisible(false)
    form.addEventListener('submit', hide)
    return () => form.removeEventListener('submit', hide)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        {...props}
        id={inputId}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn('pr-14', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-controls={inputId}
        aria-label="Show password"
        className="absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-fg-dim transition-colors hover:bg-white/[0.06] hover:text-fg"
      >
        {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
      </button>
    </div>
  )
}
