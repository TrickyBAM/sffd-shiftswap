// 1:1 chat about a shift between its poster and one other member who has a
// request on it or covers it (ARCHITECTURE §6.1 "messages", §6.3).

import type { Message } from '@/lib/types/database'
import { assertUuid, callRpc, clampLimit, resolveUserId, runList, type Sb } from './core'

/**
 * The conversation between me and `otherId` about one shift, oldest first
 * (the latest `limit` messages, default 200). RLS only returns messages I sent
 * or received, so "sent by or to the other member" is exactly this thread.
 */
export async function listMessages(
  sb: Sb,
  shiftId: string,
  otherId: string,
  options: { limit?: number } = {},
): Promise<Message[]> {
  const shift = assertUuid(shiftId, 'shift')
  const other = assertUuid(otherId, 'member')
  const rows = await runList<Message>(
    sb
      .from('messages')
      .select('*')
      .eq('shift_id', shift)
      .or(`sender_id.eq.${other},recipient_id.eq.${other}`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(clampLimit(options.limit, 200, 500)),
  )
  return rows.reverse()
}

/**
 * Sends a message (send_message). Returns its id. The recipient gets one
 * `message` alert per unread thread, refreshed by later messages.
 */
export async function sendMessage(sb: Sb, shiftId: string, recipientId: string, body: string): Promise<string> {
  return callRpc(
    sb,
    'send_message',
    { p_shift_id: shiftId, p_recipient_id: recipientId, p_body: body.trim() },
    { flush: true },
  )
}

/** Marks the other member's messages to me in this thread as read, with their alert. */
export async function markThreadRead(sb: Sb, shiftId: string, otherId: string): Promise<void> {
  await callRpc(sb, 'mark_thread_read', { p_shift_id: shiftId, p_other_id: otherId })
}

/**
 * Unread messages to me on one shift, counted per sender — for the poster's
 * thread picker ("Mike Lee · 2 new"). Pass `userId` when known to skip a
 * session lookup.
 */
export async function unreadMessagesBySender(
  sb: Sb,
  shiftId: string,
  options: { userId?: string | null } = {},
): Promise<Record<string, number>> {
  const shift = assertUuid(shiftId, 'shift')
  const me = await resolveUserId(sb, options.userId)
  const rows = await runList<Pick<Message, 'sender_id'>>(
    sb
      .from('messages')
      .select('sender_id')
      .eq('shift_id', shift)
      .eq('recipient_id', me)
      .is('read_at', null)
      .limit(500),
  )
  const counts: Record<string, number> = {}
  for (const { sender_id } of rows) {
    if (sender_id) counts[sender_id] = (counts[sender_id] ?? 0) + 1
  }
  return counts
}
