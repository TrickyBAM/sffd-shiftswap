'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/contexts/ProfileContext'
import { formatDistanceToNow } from 'date-fns'
import type { Notification, NotificationType } from '@/lib/types'

const NOTIFICATION_CONFIG: Record<
  NotificationType,
  { color: string; bgColor: string; icon: React.ReactNode }
> = {
  shift_accepted: {
    color: '#4CAF50',
    bgColor: 'rgba(76, 175, 80, 0.1)',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  shift_posted: {
    color: '#2196F3',
    bgColor: 'rgba(33, 150, 243, 0.1)',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    ),
  },
  shift_filled: {
    color: '#FF9800',
    bgColor: 'rgba(255, 152, 0, 0.1)',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  swap_confirmed: {
    color: '#9C27B0',
    bgColor: 'rgba(156, 39, 176, 0.1)',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
}

export default function NotificationsPage() {
  const { profile, loading: profileLoading } = useProfile()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const fetchNotifications = useCallback(async () => {
    if (!profile) return
    const supabase = createClient()
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })

    if (!error && data) {
      setNotifications(data as Notification[])
    }
    setLoading(false)
  }, [profile])

  useEffect(() => {
    if (!profile) return

    fetchNotifications()

    // Real-time subscription
    const supabase = createClient()
    const channel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev])
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          setNotifications((prev) =>
            prev.map((n) => (n.id === payload.new.id ? (payload.new as Notification) : n))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile, fetchNotifications])

  async function markAsRead(id: string) {
    const supabase = createClient()
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  async function markAllAsRead() {
    if (!profile) return
    const supabase = createClient()
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id)
    if (unreadIds.length === 0) return

    await supabase.from('notifications').update({ read: true }).eq('user_id', profile.id).eq('read', false)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  async function deleteNotification(id: string) {
    const supabase = createClient()
    await supabase.from('notifications').delete().eq('id', id)
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen px-4 py-6 pb-24">
        <div className="max-w-lg mx-auto">
          <h1 className="font-display text-3xl text-[#F0F0F5] mb-6">NOTIFICATIONS</h1>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-[#12121a] rounded-xl border border-white/[0.06] p-4 animate-pulse"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#1a1a26]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-[#1a1a26] rounded w-3/4" />
                    <div className="h-3 bg-[#1a1a26] rounded w-full" />
                    <div className="h-3 bg-[#1a1a26] rounded w-1/4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-6 pb-24">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl text-[#F0F0F5]">NOTIFICATIONS</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-[#8888A0] mt-0.5">
                {unreadCount} unread
              </p>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="px-4 py-1.5 text-sm font-medium text-[#D32F2F] border border-[#D32F2F] rounded-lg hover:bg-[#D32F2F]/10 transition"
            >
              Mark all as read
            </button>
          )}
        </div>

        {/* Notifications List */}
        {notifications.length === 0 ? (
          <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#1a1a26] flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-[#555570]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-[#F0F0F5] mb-1">No notifications</h3>
            <p className="text-[#555570] text-sm">
              You&apos;re all caught up. New notifications will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3 animate-fade-in-up">
            {notifications.map((notification) => {
              const config = NOTIFICATION_CONFIG[notification.type] ?? NOTIFICATION_CONFIG.shift_posted
              return (
                <div
                  key={notification.id}
                  className={`bg-[#12121a] rounded-xl border transition ${
                    notification.read ? 'border-white/[0.06]' : 'border-white/[0.06] border-l-4'
                  }`}
                  style={
                    !notification.read ? { borderLeftColor: config.color } : undefined
                  }
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: config.bgColor, color: config.color }}
                      >
                        {config.icon}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h3
                                className={`text-sm font-semibold truncate ${
                                  notification.read ? 'text-[#8888A0]' : 'text-[#F0F0F5]'
                                }`}
                              >
                                {notification.title}
                              </h3>
                              {!notification.read && (
                                <span className="w-2 h-2 rounded-full bg-[#4A9FFF] flex-shrink-0" />
                              )}
                            </div>
                            <p
                              className={`text-sm mt-0.5 ${
                                notification.read ? 'text-[#555570]' : 'text-[#8888A0]'
                              }`}
                            >
                              {notification.message}
                            </p>
                          </div>
                        </div>

                        {/* Footer: timestamp + actions */}
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-[#555570]">
                            {formatDistanceToNow(new Date(notification.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                          <div className="flex items-center gap-2">
                            {!notification.read && (
                              <button
                                onClick={() => markAsRead(notification.id)}
                                className="text-xs text-[#555570] hover:text-[#8888A0] transition"
                              >
                                Mark as read
                              </button>
                            )}
                            <button
                              onClick={() => deleteNotification(notification.id)}
                              className="text-xs text-[#555570] hover:text-red-400 transition"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
