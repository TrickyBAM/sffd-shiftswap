'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import { CalendarPlus, Copy, ExternalLink, RotateCcw } from 'lucide-react'
import { Button, buttonClasses, Card, ConfirmDialog, Field, Input, useToast } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { useProfile } from '@/components/providers/ProfileProvider'
import { calendarFeedUrls, regenerateCalendarToken } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { calendarPlatform, type CalendarPlatform } from './profile-model'
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

/** Which calendar path suits this device; null while rendering on the server. */
function usePlatform(): CalendarPlatform | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => calendarPlatform(navigator.userAgent),
    () => null,
  )
}

/** Google Calendar's "Add calendar ▸ From URL" page (works in a computer's browser). */
const GOOGLE_ADD_BY_URL = 'https://calendar.google.com/calendar/r/settings/addbyurl'

/**
 * "Add my shifts to my phone's calendar". On iPhone/iPad/Mac the main button
 * is the webcal:// subscribe link. Everywhere else (UX-15) it copies the link,
 * with steps for Google Calendar, because Android has nothing that opens
 * webcal:// links and the Google Calendar app can't subscribe by link.
 */
export function CalendarSection() {
  const { profile, refresh } = useProfile()
  const toast = useToast()
  const origin = useOrigin()
  const platform = usePlatform()
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  // The new token right after a reset, until the refreshed profile carries it.
  const [issued, setIssued] = useState<{ replaced: string; token: string } | null>(null)

  const token = issued && issued.replaced === profile.calendar_token ? issued.token : profile.calendar_token
  const urls = origin && token ? calendarFeedUrls(origin, token) : null
  const apple = platform === 'apple'

  async function copyLink() {
    if (!urls) return
    try {
      await navigator.clipboard.writeText(urls.https)
      toast.success(
        'Link copied',
        apple ? 'Paste it into your calendar app to subscribe.' : 'Now add it in Google Calendar (steps below).',
      )
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

  const linkField = (
    <Field
      className="mt-4"
      label="Calendar link"
      hint={
        apple
          ? 'Using Google Calendar? On a computer, open Google Calendar, choose Other calendars, then From URL, and paste this link.'
          : undefined
      }
    >
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          readOnly
          value={urls?.https ?? ''}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate"
        />
        {apple ? (
          <Button
            variant="secondary"
            onClick={copyLink}
            disabled={!urls}
            icon={<Copy size={16} aria-hidden="true" />}
            className="shrink-0"
          >
            Copy
          </Button>
        ) : null}
      </div>
    </Field>
  )

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

        {apple ? (
          <>
            <a
              href={urls?.webcal ?? undefined}
              aria-disabled={urls ? undefined : true}
              className={cn(buttonClasses({ fullWidth: true, className: 'mt-4' }), !urls && 'pointer-events-none opacity-50')}
            >
              <CalendarPlus size={18} aria-hidden="true" />
              Add to my calendar
            </a>
            <p className="mt-2 text-sm text-fg-dim">This opens your Calendar app. Tap Subscribe, then Add.</p>
            {linkField}
          </>
        ) : (
          <>
            <Button
              fullWidth
              className="mt-4"
              onClick={copyLink}
              disabled={!urls}
              icon={<Copy size={18} aria-hidden="true" />}
            >
              Copy calendar link
            </Button>
            <GoogleCalendarSteps platform={platform} />
            {linkField}
            <p className="mt-3 text-sm text-fg-muted">
              Using a different calendar app?{' '}
              <a
                href={urls?.webcal ?? undefined}
                aria-disabled={urls ? undefined : true}
                className={cn(
                  'font-semibold text-accent-blue underline-offset-2 hover:underline',
                  !urls && 'pointer-events-none opacity-50',
                )}
              >
                Subscribe with this link
              </a>{' '}
              if your app opens it, or paste the copied link where the app asks for a calendar URL.
            </p>
          </>
        )}

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

/** How to add the copied link to Google Calendar (it can only be done on the website). */
function GoogleCalendarSteps({ platform }: { platform: CalendarPlatform | null }) {
  const android = platform === 'android'
  return (
    <div className="mt-3 rounded-xl bg-elevated p-3 text-sm text-fg-muted">
      <p className="font-semibold text-fg">Add it to Google Calendar</p>
      {android ? (
        <p className="mt-1">
          The Google Calendar app can&apos;t add a calendar from a link, so do this once on a computer (or in your
          phone&apos;s browser with Desktop site turned on):
        </p>
      ) : null}
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Tap Copy calendar link.</li>
        <li>
          Open{' '}
          {android ? (
            <span className="font-semibold text-fg">calendar.google.com</span>
          ) : (
            <a
              href={GOOGLE_ADD_BY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-accent-blue underline-offset-2 hover:underline"
            >
              Google Calendar
              <ExternalLink size={14} aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          . Next to Other calendars, choose + then From URL.
        </li>
        <li>Paste the link and choose Add calendar.</li>
        {android ? (
          <li>
            Your shifts then show in the Google Calendar app too. If they don&apos;t, open the app&apos;s Settings, tap
            the new calendar and turn on Sync.
          </li>
        ) : null}
      </ol>
    </div>
  )
}
