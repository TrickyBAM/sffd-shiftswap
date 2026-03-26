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
  { href: '/dashboard', label: 'Calendar', icon: Home },
  { href: '/shift-board', label: 'Board', icon: ClipboardList },
  { href: '/post-shift', label: 'Post', icon: PlusCircle, isCenter: true },
  { href: '/notifications', label: 'Alerts', icon: Bell },
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

    async function fetchUnreadCount() {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('read', false)

      setUnreadCount(count ?? 0)
    }

    fetchUnreadCount()

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

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 hidden h-full w-64 border-r border-white/[0.06] bg-[#12121a] md:flex md:flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-5 py-5">
          <Flame size={28} className="text-[#D32F2F]" />
          <span className="font-display text-2xl tracking-wide text-[#F0F0F5]">
            SHIFT<span className="text-[#D32F2F]">SWAP</span>
          </span>
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
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#D32F2F]/10 text-[#D32F2F]'
                    : 'text-[#8888A0] hover:bg-white/[0.04] hover:text-[#F0F0F5]'
                }`}
              >
                <div className="relative">
                  <Icon size={20} />
                  {item.href === '/notifications' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D32F2F] px-0.5 text-[10px] font-bold text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Mobile Bottom Tab Bar - Glassmorphic */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-end justify-around glass-nav border-t border-white/[0.06] md:hidden pb-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)

          if (item.isCenter) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative -mt-4 flex flex-col items-center"
              >
                <div
                  className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl text-white shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #D32F2F 0%, #B71C1C 100%)',
                    boxShadow: '0 4px 20px rgba(211, 47, 47, 0.4)',
                  }}
                >
                  <Icon size={24} />
                </div>
                <span className="text-[10px] mt-1 text-[#8888A0]">{item.label}</span>
              </Link>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center gap-0.5 pt-1.5"
            >
              <div className="relative">
                <Icon
                  size={22}
                  className={active ? 'text-[#D32F2F]' : 'text-[#555570]'}
                />
                {item.href === '/notifications' && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D32F2F] px-0.5 text-[10px] font-bold text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] ${
                  active ? 'text-[#D32F2F] font-medium' : 'text-[#555570]'
                }`}
              >
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
