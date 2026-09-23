'use client'

import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { Button, Card, CardHeader, ErrorState, Field, Select, Skeleton, Textarea, cn, useToast } from '@/components/ui'
import { formatTimePT, todayPT } from '@/lib/sffd/dates'
import type { Message } from '@/lib/types/database'
import { toastActionError } from '@/app/(app)/board/_lib/errors'
import { chatDayLabel, currentTime } from '@/app/(app)/board/_lib/format'
import { defaultChatPartner, groupMessagesByDay, type ChatPartner } from '../_lib/trade-model'
import { MESSAGE_MAX, useChatThread, useUnreadBySender } from '../_lib/useChatThread'

export interface ChatPanelProps {
  ref?: Ref<HTMLDivElement>
  /** The original shift's id (one thread per pair, whichever leg is shown). */
  shiftId: string
  me: string
  /** Who I can talk to (chatPartners()); never empty. */
  partners: readonly ChatPartner[]
  /** Thread picked elsewhere (e.g. "Message" on a request); null = default. */
  selected: string | null
  onSelect: (memberId: string) => void
  /** The poster gets a thread picker and per-thread unread counts. */
  isPoster: boolean
  /** Sending off (offline snapshot). */
  disabled: boolean
}

/** 1:1 chat about this shift between me and the other member. */
export function ChatPanel({ ref, shiftId, me, partners, selected, onSelect, isPoster, disabled }: ChatPanelProps) {
  const multi = isPoster && partners.length > 1
  const { counts: unread, loaded } = useUnreadBySender(shiftId, me, multi)

  // Pick the first thread once (one with unread messages first) so it doesn't jump later.
  const [autoPick, setAutoPick] = useState<string | null>(null)
  if (autoPick == null && loaded && partners.length > 0) {
    setAutoPick(defaultChatPartner(partners, unread))
  }
  const partner = partners.find((p) => p.id === (selected ?? autoPick)) ?? partners[0]

  return (
    <div ref={ref} className="scroll-mt-24">
      <Card as="section" aria-labelledby="trade-chat-title">
        <CardHeader
          title={
            <span id="trade-chat-title" className="inline-flex items-center gap-2">
              <MessageSquare size={18} aria-hidden="true" className="text-fg-dim" />
              Messages
            </span>
          }
          description={partner ? `Only you and ${partner.name} can see these.` : undefined}
        />

        {multi ? (
          <Field label="Conversation with" className="mb-3">
            <Select value={partner?.id ?? ''} onChange={(e) => onSelect(e.target.value)}>
              {partners.map((p) => {
                const n = unread[p.id] ?? 0
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.note}
                    {n > 0 ? ` · ${n} new` : ''}
                  </option>
                )
              })}
            </Select>
          </Field>
        ) : null}

        {partner ? <Thread key={partner.id} shiftId={shiftId} me={me} partner={partner} disabled={disabled} /> : null}
      </Card>
    </div>
  )
}

function Thread({ shiftId, me, partner, disabled }: { shiftId: string; me: string; partner: ChatPartner; disabled: boolean }) {
  const thread = useChatThread(shiftId, partner.id, me)
  const messages = thread.messages
  const lastId = messages?.at(-1)?.id ?? null
  const listRef = useRef<HTMLDivElement>(null)

  // Announce messages that arrive while the thread is open (not the history).
  const [tracked, setTracked] = useState<string | null | undefined>(undefined)
  const [announcement, setAnnouncement] = useState('')
  if (messages && tracked !== lastId) {
    if (tracked !== undefined) {
      const from = tracked ? messages.findIndex((m) => m.id === tracked) + 1 : 0
      const fresh = messages.slice(from).filter((m) => m.sender_id !== me)
      const latest = fresh.at(-1)
      if (latest) {
        setAnnouncement(
          fresh.length > 1
            ? `${fresh.length} new messages from ${partner.name}. Latest: ${latest.body}`
            : `New message from ${partner.name}: ${latest.body}`,
        )
      }
    }
    setTracked(lastId)
  }

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])

  const [today] = useState(() => todayPT(new Date(currentTime())))

  return (
    <div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {thread.loading ? (
        <div role="status" className="space-y-2 py-2">
          <span className="sr-only">Loading messages…</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="ml-auto h-10 w-1/2" />
        </div>
      ) : thread.error ? (
        <ErrorState title="Couldn't load messages" message={thread.error.message} onRetry={thread.retry} className="py-6" />
      ) : messages && messages.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-fg-muted">
          No messages yet. Say hi to {partner.name}.
        </p>
      ) : messages ? (
        <div
          ref={listRef}
          tabIndex={0}
          aria-label={`Messages with ${partner.name}`}
          className="max-h-[26rem] space-y-3 overflow-y-auto overscroll-contain rounded-xl pr-1"
        >
          {groupMessagesByDay(messages).map((day) => (
            <section key={day.date} aria-label={chatDayLabel(day.date, today)}>
              <p className="py-1 text-center text-xs text-fg-dim" aria-hidden="true">
                <span className="rounded-full bg-elevated px-2 py-0.5">{chatDayLabel(day.date, today)}</span>
              </p>
              <ol className="mt-1 space-y-1.5">
                {day.items.map((m) => (
                  <Bubble key={m.id} message={m} mine={m.sender_id === me} otherName={partner.name} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}

      <Composer partnerName={partner.name} disabled={disabled || thread.loading} onSend={thread.send} />
    </div>
  )
}

function Bubble({ message, mine, otherName }: { message: Message; mine: boolean; otherName: string }) {
  return (
    <li className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
          mine ? 'rounded-br-md bg-sffd-red/20 text-fg' : 'rounded-bl-md bg-elevated text-fg',
        )}
      >
        <span className="sr-only">{mine ? 'You' : otherName}: </span>
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className={cn('mt-0.5 text-[11px] text-fg-dim', mine && 'text-right')}>
          {formatTimePT(message.created_at)}
          {mine && message.read_at ? ' · Seen' : ''}
        </p>
      </div>
    </li>
  )
}

function Composer({
  partnerName,
  disabled,
  onSend,
}: {
  partnerName: string
  disabled: boolean
  onSend: (body: string) => Promise<void>
}) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const text = draft.trim()

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!text || sending || disabled) return
    setSending(true)
    try {
      await onSend(text)
      setDraft('')
    } catch (err) {
      toastActionError(toast, err, "Couldn't send your message")
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <Field label={`Message ${partnerName}`}>
        <Textarea
          rows={2}
          maxLength={MESSAGE_MAX}
          showCount
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          }}
          placeholder="Type a message"
          className="min-h-16"
        />
      </Field>
      <Button type="submit" fullWidth loading={sending} disabled={disabled || !text} icon={<Send size={16} aria-hidden="true" />}>
        Send
      </Button>
    </form>
  )
}
