'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useFieldControl } from '@/components/ui/Field'
import { Input, type InputProps } from '@/components/ui/Input'
import { cn } from '@/components/ui/cn'

export type PasswordInputProps = Omit<InputProps, 'type'>

/**
 * Password box with a show/hide toggle (a 44 px button inside the field).
 * Use inside a <Field>; works with react-hook-form's register().
 */
export function PasswordInput({ className, id, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const field = useFieldControl()
  const inputId = id ?? field?.id

  return (
    <div className="relative">
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
