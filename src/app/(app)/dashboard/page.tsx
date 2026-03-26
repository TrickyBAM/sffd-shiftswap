'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/contexts/ProfileContext'
import { Shift, Schedule } from '@/lib/types'
import { getWorkDatesForMonth } from '@/lib/schedule'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Link from 'next/link'
import {
  getStationLabel,
  getBattalionLabel,
  getDivisionName,
} from '@/lib/sffd'

type CancelTarget = { shiftId: string; posterName: string }
type DayType = 'work' | 'open' | 'covered' | 'swapmatch' | null

interface DayInfo {
  date: Date
  dateStr: string
  type: DayType
  shifts: Shift[]
  isWorkDay: boolean
}

export default function DashboardPage() {
  const { profile, loading: profileLoading } = useProfile()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [shifts, setShifts] = useState<Shift[]>([])
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [shiftsLoading, setShiftsLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<DayInfo | null>(null)
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const supabase = useMemo(() => createClient(), [])

  const handleCancelShift = async () => {
    if (!cancelTarget || !profile) return
    setCancelling(true)
    try {
      const { error } = await supabase
        .from('shifts')
        .update({ status: 'cancelled' })
        .eq('id', cancelTarget.shiftId)
        .eq('poster_id', profile.id)

      if (error) throw error

      await supabase
        .from('profiles')
        .update({
          trade_requested: Math.max(0, profile.trade_requested - 1),
          trade_outstanding: Math.max(0, profile.trade_outstanding - 1),
        })
        .eq('id', profile.id)

      setCancelTarget(null)
      setSelectedDay(null)
      showToast('Shift cancelled successfully.', 'success')
      fetchShifts()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to cancel shift'
      showToast(message, 'error')
    } finally {
      setCancelling(false)
    }
  }

  const fetchShifts = useCallback(async () => {
    if (!profile) return

    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd')

    const { data, error } = await supabase
      .from('shifts')
      .select('*')
      .or(`poster_id.eq.${profile.id},coverer_id.eq.${profile.id}`)
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date', { ascending: true })

    if (!error && data) {
      setShifts(data as Shift[])
    }
    setShiftsLoading(false)
  }, [profile, currentMonth, supabase])

  useEffect(() => {
    if (!profile) return
    const fetchSchedule = async () => {
      const { data } = await supabase
        .from('schedules')
        .select('*')
        .eq('user_id', profile.id)
        .single()
      if (data) setSchedule(data as Schedule)
    }
    fetchSchedule()
  }, [profile, supabase])

  useEffect(() => {
    if (!profile) return
    setShiftsLoading(true)
    fetchShifts()
  }, [fetchShifts, profile])

  useEffect(() => {
    if (!profile) return

    const channel = supabase
      .channel('shifts-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts' },
        () => { fetchShifts() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profile, supabase, fetchShifts])

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calendarStart = startOfWeek(monthStart)
  const calendarEnd = endOfWeek(monthEnd)
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  const workDays = useMemo(() => {
    if (!schedule || !schedule.setup_complete) return []
    return getWorkDatesForMonth(
      schedule.anchor_date,
      schedule.gap_pattern,
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1
    )
  }, [schedule, currentMonth])

  function getDayInfo(date: Date): DayInfo {
    const dateStr = format(date, 'yyyy-MM-dd')
    const dayShifts = shifts.filter((s) => s.date === dateStr)
    const isWorkDay = workDays.includes(dateStr)

    let type: DayType = null
    const hasSwapMatch = dayShifts.some((s) => s.coverer_id && s.return_dates && s.return_dates.length > 0)
    const hasOpen = dayShifts.some((s) => s.status === 'open')
    const hasCovered = dayShifts.some((s) => s.status === 'covered')

    if (hasSwapMatch) type = 'swapmatch'
    else if (hasOpen) type = 'open'
    else if (hasCovered) type = 'covered'
    else if (isWorkDay) type = 'work'

    return { date, dateStr, type, shifts: dayShifts, isWorkDay }
  }

  const dayColors: Record<string, { bg: string; text: string }> = {
    work: { bg: 'bg-[#D32F2F]/10', text: 'text-[#FF3D3D]' },
    open: { bg: 'bg-[#FF6B35]/10', text: 'text-[#FF6B35]' },
    covered: { bg: 'bg-[#8888A0]/10', text: 'text-[#8888A0]' },
    swapmatch: { bg: 'bg-[#9C6AFF]/10', text: 'text-[#9C6AFF]' },
  }

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const stats = profile
    ? [
        { label: 'Earned', value: profile.trade_earned, color: '#34D399' },
        { label: 'Requested', value: profile.trade_requested, color: '#FF6B35' },
        { label: 'Outstanding', value: profile.trade_outstanding, color: '#4A9FFF' },
      ]
    : []

  const loading = profileLoading || shiftsLoading

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-xl text-sm font-medium shadow-lg ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6 animate-fade-in-up">
        <div>
          <h1 className="font-display text-3xl tracking-wide">
            SHIFT<span className="text-[#D32F2F]">SWAP</span>
          </h1>
          {profile && (
            <p className="text-[#8888A0] text-sm mt-0.5">
              {getStationLabel(profile.station)} &middot; {getBattalionLabel(profile.battalion)} &middot; {getDivisionName(profile.division)}
            </p>
          )}
        </div>
        {profile && (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D32F2F] to-[#FF6B35] flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-white">
              {profile.full_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
            </span>
          </div>
        )}
      </div>

      {/* Trade Score Banner */}
      <div className="animate-fade-in-up delay-1 mb-6">
        <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #D32F2F, #FF6B35, #4A9FFF)' }} />
          <div className="grid grid-cols-3 gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="font-display text-3xl" style={{ color: stat.color }}>
                  {stat.value}
                </p>
                <p className="text-xs text-[#8888A0] mt-0.5 uppercase tracking-wide">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="animate-fade-in-up delay-2 bg-[#12121a] rounded-2xl border border-white/[0.06] overflow-hidden">
        {/* Calendar Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.06]">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 rounded-xl hover:bg-white/[0.04] transition-colors text-[#8888A0] hover:text-[#F0F0F5]"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="font-display text-2xl tracking-wide text-[#F0F0F5]">
            {format(currentMonth, 'MMMM yyyy').toUpperCase()}
          </h2>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 rounded-xl hover:bg-white/[0.04] transition-colors text-[#8888A0] hover:text-[#F0F0F5]"
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-white/[0.06]">
          {weekDays.map((day) => (
            <div key={day} className="py-2 text-center text-xs font-medium text-[#555570] uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#222233] border-t-[#4A9FFF] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day) => {
              const info = getDayInfo(day)
              const inMonth = isSameMonth(day, currentMonth)
              const today = isToday(day)
              const colors = info.type ? dayColors[info.type] : null

              return (
                <button
                  key={info.dateStr}
                  onClick={() => setSelectedDay(info)}
                  className={`
                    relative aspect-square flex flex-col items-center justify-center
                    border-b border-r border-white/[0.03] transition-colors rounded-[12px] m-0.5
                    ${inMonth ? 'hover:bg-white/[0.04]' : 'opacity-25'}
                    ${colors ? colors.bg : ''}
                    ${today ? 'ring-1 ring-inset ring-[#D32F2F]/50' : ''}
                  `}
                >
                  <span
                    className={`
                      text-sm font-medium
                      ${today ? 'bg-[#D32F2F] text-white w-7 h-7 rounded-full flex items-center justify-center' : ''}
                      ${!today && colors ? colors.text : ''}
                      ${!today && !colors && inMonth ? 'text-[#F0F0F5]' : ''}
                      ${!today && !colors && !inMonth ? 'text-[#555570]' : ''}
                    `}
                  >
                    {format(day, 'd')}
                  </span>
                  {info.shifts.length > 0 && (
                    <div className="flex gap-0.5 mt-1">
                      {info.shifts.length <= 3 ? (
                        info.shifts.map((s) => (
                          <span
                            key={s.id}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                s.status === 'open' ? '#FF6B35'
                                : s.status === 'covered' ? '#8888A0'
                                : '#9C6AFF',
                            }}
                          />
                        ))
                      ) : (
                        <span className="text-[10px] text-[#8888A0]">{info.shifts.length}</span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3 border-t border-white/[0.06]">
          {[
            { color: '#D32F2F', label: 'Work Day' },
            { color: '#FF6B35', label: 'Open Shift' },
            { color: '#8888A0', label: 'Covered' },
            { color: '#9C6AFF', label: 'SwapMatch' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-xs text-[#555570]">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] max-w-sm w-full p-6">
            <h2 className="font-display text-2xl text-[#F0F0F5] mb-2">CANCEL SHIFT</h2>
            <p className="text-sm text-[#8888A0] mb-4">
              Are you sure you want to cancel this shift? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl bg-[#1a1a26] border border-white/[0.06] text-[#8888A0] text-sm font-medium hover:bg-[#222233] transition-colors"
              >
                Keep Shift
              </button>
              <button
                onClick={handleCancelShift}
                disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl bg-[#D32F2F] text-white text-sm font-semibold hover:bg-[#B71C1C] disabled:opacity-50 transition-colors"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Day Detail Modal */}
      {selectedDay && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="bg-[#12121a] rounded-t-2xl sm:rounded-2xl border border-white/[0.06] w-full sm:max-w-md max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div>
                <h3 className="text-lg font-semibold text-[#F0F0F5]">
                  {format(selectedDay.date, 'EEEE, MMMM d')}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  {selectedDay.isWorkDay && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#D32F2F]/10 text-[#FF3D3D] border border-[#D32F2F]/20">
                      Work Day
                    </span>
                  )}
                  {selectedDay.type && selectedDay.type !== 'work' && (
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full border"
                      style={{
                        backgroundColor: selectedDay.type === 'open' ? 'rgba(255,107,53,0.1)' : selectedDay.type === 'covered' ? 'rgba(136,136,160,0.1)' : 'rgba(156,106,255,0.1)',
                        color: selectedDay.type === 'open' ? '#FF6B35' : selectedDay.type === 'covered' ? '#8888A0' : '#9C6AFF',
                        borderColor: selectedDay.type === 'open' ? 'rgba(255,107,53,0.2)' : selectedDay.type === 'covered' ? 'rgba(136,136,160,0.2)' : 'rgba(156,106,255,0.2)',
                      }}
                    >
                      {selectedDay.type === 'open' ? 'Open Shift' : selectedDay.type === 'covered' ? 'Covered' : 'SwapMatch'}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-1.5 rounded-xl hover:bg-white/[0.04] transition-colors text-[#555570] hover:text-[#F0F0F5]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              {selectedDay.shifts.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-[#555570]">
                    {selectedDay.isWorkDay ? 'You are scheduled to work this day.' : 'No shifts for this day.'}
                  </p>
                  {selectedDay.isWorkDay && (
                    <Link
                      href={`/post-shift?date=${selectedDay.dateStr}`}
                      className="inline-block mt-3 px-4 py-2 text-sm font-medium bg-[#FF6B35] hover:bg-[#e55a2a] text-white rounded-xl transition"
                    >
                      Post this shift for trade?
                    </Link>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDay.shifts.map((shift) => (
                    <div key={shift.id} className="bg-[#1a1a26] rounded-xl border border-white/[0.06] p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-[#F0F0F5]">{shift.shift_type}</span>
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: shift.status === 'open' ? 'rgba(255,107,53,0.1)' : shift.status === 'covered' ? 'rgba(136,136,160,0.1)' : 'rgba(244,67,54,0.1)',
                            color: shift.status === 'open' ? '#FF6B35' : shift.status === 'covered' ? '#8888A0' : '#FF3D3D',
                          }}
                        >
                          {shift.status.charAt(0).toUpperCase() + shift.status.slice(1)}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-[#8888A0]">
                        <p><span className="text-[#555570]">Posted by:</span> {shift.poster_name}</p>
                        <p><span className="text-[#555570]">Station:</span> {shift.station} &middot; <span className="text-[#555570]">Rank:</span> {shift.rank}</p>
                        {shift.coverer_name && <p><span className="text-[#555570]">Covered by:</span> {shift.coverer_name}</p>}
                        {shift.notes && <p className="mt-1.5 text-[#555570] italic">{shift.notes}</p>}
                      </div>
                      {shift.poster_id === profile?.id && shift.status === 'open' && (
                        <button
                          onClick={() => setCancelTarget({ shiftId: shift.id, posterName: shift.poster_name })}
                          className="mt-2 w-full py-1.5 text-xs font-medium text-red-400 border border-red-400/20 rounded-xl hover:bg-red-400/10 transition"
                        >
                          Cancel Shift
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
