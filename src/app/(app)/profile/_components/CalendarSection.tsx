'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import { CalendarPlus, Copy, RotateCcw } from 'lucide-react'
import { Button, buttonClasses, Card, ConfirmDialog, Field, Input, useToast } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { useProfile } from '@/components/providers/ProfileProvider'
import { calendarFeedUrls, regenerateCalendarToken } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { ProfileSection } from './ProfileSection'

const noopSubscribe = () => () => {}

/** This site's origin in the browser; null while rendering on the server. */
function useOrigin(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => null,
  )
}

/** "Add my shifts to my phone's calendar": webcal subscribe link, copyable https link, reset. */
export function CalendarSection() {
  const { profile, refresh } = useProfile()
  const toast = useToast()
  const origin = useOrigin()
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  // The new token right after a reset, until the refreshed profile carries it.
  const [issued, setIssued] = useState<{ replaced: string; token: string } | null>(null)

  const token = issued && issued.replaced === profile.calendar_token ? issued.token : profile.calendar_token
  const urls = origin && token ? calendarFeedUrls(origin, token) : null

  async function copyLink() {
    if (!urls) return
    try {
      await navigator.clipboard.writeText(urls.https)
      toast.success('Link copied', 'Paste it into your calendar app to subscribe.')
    } catch {
      inputRef.current?.focus()
      inputRef.current?.select()
      toast.info("Couldn't copy it automatically", 'The link is selected in the box. Copy it from there.')
    }
  }

  async function resetLink() {
    let next: string
    try {
      next = await regenerateCalendarToken(createClient())
    } catch (error) {
      toast.error("Couldn't reset your calendar link", errorMessage(error))
      throw error
    }
    setIssued({ replaced: profile.calendar_token, token: next })
    toast.success('New calendar link ready', 'Add it to your calendar again. The old link no longer works.')
    void refresh().catch(() => {
      // The new link is already on screen; the profile catches up on the next load.
    })
  }

  return (
    <ProfileSection id="profile-calendar" title="Calendar">
      <Card as="article" aria-labelledby="profile-calendar-card">
        <h3 id="profile-calendar-card" className="font-semibold text-fg">
          Add my shifts to my phone&apos;s calendar
        </h3>
        <p className="mt-1 text-sm text-fg-muted">
          Your work days, the shifts you cover and your trades show up in your calendar app and stay up to date on
          their own.
        </p>

        <a
          href={urls?.webcal ?? undefined}
          aria-disabled={urls ? undefined : true}
          className={cn(buttonClasses({ fullWidth: true, className: 'mt-4' }), !urls && 'pointer-events-none opacity-50')}
        >
          <CalendarPlus size={18} aria-hidden="true" />
          Add to my calendar
        </a>
        <p className="mt-2 text-sm text-fg-dim">On iPhone this opens the Calendar app. Tap Subscribe, then Add.</p>

        <Field
          className="mt-4"
          label="Calendar link"
          hint="Using Google Calendar? On a computer, open Google Calendar, choose Other calendars, then From URL, and paste this link."
        >
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              readOnly
              value={urls?.https ?? ''}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 truncate"
            />
            <Button
              variant="secondary"
              onClick={copyLink}
              disabled={!urls}
              icon={<Copy size={16} aria-hidden="true" />}
              className="shrink-0"
            >
              Copy
            </Button>
          </div>
        </Field>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-sm text-fg-muted">Shared this link by mistake? Reset it.</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmReset(true)}
            icon={<RotateCcw size={16} aria-hidden="true" />}
          >
            Reset link
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetLink}
        title="Reset your calendar link?"
        description="Your old link stops working right away. Any calendar using it stops updating, so you'll need to add your shifts to your calendar again with the new link."
        confirmLabel="Reset link"
        cancelLabel="Keep my link"
        tone="danger"
      />
    </ProfileSection>
  )
}
