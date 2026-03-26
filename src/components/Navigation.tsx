'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  PlusCircle,
  ClipboardList,
  User,
  Bell,
  Flame,
} from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import { useProfile } from '@/contexts/ProfileContext'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/post-shift', label: 'Post Shift', icon: PlusCircle },
  { href: '/shift-board', label: 'Shift Board', icon: ClipboardList },
  { href: '/profile', label: 'Profile', icon: User },
]

export default function Navigation() {
  const pathname = usePathname()
  const { profile } = useProfile()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Fetch initial unread count
    async function fetchUnreadCount() {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('read', false)

      setUnreadCount(count ?? 0)
    }

    fetchUnreadCount()

    // Subscribe to real-time notifications
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          setUnreadCount((prev) => prev + 1)
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
        () => {
          fetchUnreadCount()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile.id])

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  const NotificationBell = (
    <Link
      href="/notifications"
      className="relative flex flex-col items-center justify-center"
    >
      <Bell
        size={24}
        className={
          isActive('/notifications')
            ? 'text-[#D32F2F]'
            : 'text-gray-400'
        }
      />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#D32F2F] px-1 text-[10px] font-bold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 hidden h-full w-64 border-r border-[#333] bg-[#1a1a1a] md:flex md:flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2 border-b border-[#333] px-5 py-5">
          <Flame size={28} className="text-[#D32F2F]" />
          <span className="text-lg font-bold text-white">SFFD ShiftSwap</span>
        </div>

        {/* Nav Items */}
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#D32F2F]/10 text-[#D32F2F]'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={20} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Notification bell at bottom of sidebar */}
        <div className="border-t border-[#333] px-3 py-4">
          <Link
            href="/notifications"
            className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
              isActive('/notifications')
                ? 'bg-[#D32F2F]/10 text-[#D32F2F]'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <div className="relative">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D32F2F] px-0.5 text-[10px] font-bold text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            Notifications
          </Link>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-[#333] bg-[#1a1a1a] md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-0.5"
            >
              <Icon
                size={24}
                className={active ? 'text-[#D32F2F]' : 'text-gray-400'}
              />
              <span
                className={`text-[10px] ${
                  active ? 'text-[#D32F2F]' : 'text-gray-400'
                }`}
              >
                {item.label}
              </span>
            </Link>
          )
        })}
        {NotificationBell}
      </nav>
    </>
  )
}
