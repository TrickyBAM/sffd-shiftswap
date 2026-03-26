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

  const supabase = useMemo(() => createClient(), [])

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

  // Fetch schedule
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

  // Fetch shifts when month or profile changes
  useEffect(() => {
    if (!profile) return
    setShiftsLoading(true)
    fetchShifts()
  }, [fetchShifts, profile])

  // Real-time subscription for shifts table
  useEffect(() => {
    if (!profile) return

    const channel = supabase
      .channel('shifts-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shifts',
        },
        () => {
          fetchShifts()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile, supabase, fetchShifts])

  // Build calendar grid
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calendarStart = startOfWeek(monthStart) // Sunday
  const calendarEnd = endOfWeek(monthEnd) // Saturday
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  // Get work days for the month from schedule
  const workDays = useMemo(() => {
    if (!schedule || !schedule.setup_complete) return []
    return getWorkDatesForMonth(
      schedule.anchor_date,
      schedule.gap_pattern,
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1
    )
  }, [schedule, currentMonth])

  // Build day info
  function getDayInfo(date: Date): DayInfo {
    const dateStr = format(date, 'yyyy-MM-dd')
    const dayShifts = shifts.filter((s) => s.date === dateStr)
    const isWorkDay = workDays.includes(dateStr)

    let type: DayType = null

    // Determine the most important status to display
    const hasSwapMatch = dayShifts.some(
      (s) => s.coverer_id && s.return_dates && s.return_dates.length > 0
    )
    const hasOpen = dayShifts.some((s) => s.status === 'open')
    const hasCovered = dayShifts.some((s) => s.status === 'covered')

    if (hasSwapMatch) {
      type = 'swapmatch'
    } else if (hasOpen) {
      type = 'open'
    } else if (hasCovered) {
      type = 'covered'
    } else if (isWorkDay) {
      type = 'work'
    }

    return { date, dateStr, type, shifts: dayShifts, isWorkDay }
  }

  const dayColors: Record<string, { bg: string; text: string; border: string }> = {
    work: { bg: 'bg-[#D32F2F]/15', text: 'text-[#D32F2F]', border: 'border-[#D32F2F]/40' },
    open: { bg: 'bg-[#FF5722]/15', text: 'text-[#FF5722]', border: 'border-[#FF5722]/40' },
    covered: { bg: 'bg-[#9E9E9E]/15', text: 'text-[#9E9E9E]', border: 'border-[#9E9E9E]/40' },
    swapmatch: { bg: 'bg-[#9C27B0]/15', text: 'text-[#9C27B0]', border: 'border-[#9C27B0]/40' },
  }

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const stats = profile
    ? [
        { label: 'Requested', value: profile.trade_requested, color: '#FF5722' },
        { label: 'Filled', value: profile.trade_filled, color: '#4CAF50' },
        { label: 'Outstanding', value: profile.trade_outstanding, color: '#FFC107' },
        { label: 'Earned', value: profile.trade_earned, color: '#2196F3' },
      ]
    : []

  const loading = profileLoading || shiftsLoading

  return (
    <div className="min-h-screen bg-[#111111] px-4 py-6 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-lg text-sm font-medium shadow-lg ${
            toast.type === 'success'
              ? 'bg-green-900/90 text-green-200 border border-green-700'
              : 'bg-red-900/90 text-red-200 border border-red-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Trade Score Card */}
      <div className="mb-6">
        <h2 className="text-sm font-medium text-[#999] uppercase tracking-wider mb-3">
          Trade Score
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] p-4 text-center"
            >
              <p className="text-2xl sm:text-3xl font-bold" style={{ color: stat.color }}>
                {stat.value}
              </p>
              <p className="text-xs text-[#888] mt-1 uppercase tracking-wide">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] overflow-hidden">
        {/* Calendar Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#2a2a2a]">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 rounded-lg hover:bg-[#2a2a2a] transition-colors text-[#ccc] hover:text-white"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold text-[#f5f5f5]">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 rounded-lg hover:bg-[#2a2a2a] transition-colors text-[#ccc] hover:text-white"
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-[#2a2a2a]">
          {weekDays.map((day) => (
            <div
              key={day}
              className="py-2 text-center text-xs font-medium text-[#666] uppercase tracking-wider"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#333] border-t-[#2196F3] rounded-full animate-spin" />
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
                    relative aspect-square sm:aspect-[4/3] flex flex-col items-center justify-center
                    border-b border-r border-[#1f1f1f] transition-colors
                    ${inMonth ? 'hover:bg-[#222]' : 'opacity-30'}
                    ${colors ? colors.bg : ''}
                    ${today ? 'ring-1 ring-inset ring-[#f5f5f5]/30' : ''}
                  `}
                >
                  <span
                    className={`
                      text-sm sm:text-base font-medium
                      ${today ? 'bg-[#D32F2F] text-white w-7 h-7 rounded-full flex items-center justify-center' : ''}
                      ${!today && colors ? colors.text : ''}
                      ${!today && !colors && inMonth ? 'text-[#ccc]' : ''}
                      ${!today && !colors && !inMonth ? 'text-[#555]' : ''}
                    `}
                  >
                    {format(day, 'd')}
                  </span>
                  {/* Dot indicator for shifts */}
                  {info.shifts.length > 0 && (
                    <div className="flex gap-0.5 mt-1">
                      {info.shifts.length <= 3 ? (
                        info.shifts.map((s) => (
                          <span
                            key={s.id}
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                s.status === 'open'
                                  ? '#FF5722'
                                  : s.status === 'covered'
                                    ? '#9E9E9E'
                                    : '#9C27B0',
                            }}
                          />
                        ))
                      ) : (
                        <span className="text-[10px] text-[#888]">{info.shifts.length}</span>
                      )}
                    </div>
                  )}
                  {/* Work day indicator (small bar) */}
                  {info.isWorkDay && info.type === 'work' && (
                    <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-[#D32F2F]/60" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3 border-t border-[#2a2a2a]">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#D32F2F]" />
            <span className="text-xs text-[#888]">Work Day</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF5722]" />
            <span className="text-xs text-[#888]">Open Shift</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#9E9E9E]" />
            <span className="text-xs text-[#888]">Covered</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#9C27B0]" />
            <span className="text-xs text-[#888]">SwapMatch</span>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="bg-[#1a1a1a] rounded-xl border border-[#333] max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-[#f5f5f5] mb-2">Cancel Shift</h2>
            <p className="text-sm text-[#999] mb-4">
              Are you sure you want to cancel this shift? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl bg-[#252525] border border-[#444] text-[#ccc] text-sm font-medium hover:bg-[#333] transition-colors"
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
            className="bg-[#1a1a1a] rounded-t-2xl sm:rounded-xl border border-[#2a2a2a] w-full sm:max-w-md max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
              <div>
                <h3 className="text-lg font-semibold text-[#f5f5f5]">
                  {format(selectedDay.date, 'EEEE, MMMM d')}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  {selectedDay.isWorkDay && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#D32F2F]/15 text-[#D32F2F] border border-[#D32F2F]/30">
                      Work Day
                    </span>
                  )}
                  {selectedDay.type && selectedDay.type !== 'work' && (
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full border"
                      style={{
                        backgroundColor:
                          selectedDay.type === 'open'
                            ? 'rgba(255,87,34,0.15)'
                            : selectedDay.type === 'covered'
                              ? 'rgba(158,158,158,0.15)'
                              : 'rgba(156,39,176,0.15)',
                        color:
                          selectedDay.type === 'open'
                            ? '#FF5722'
                            : selectedDay.type === 'covered'
                              ? '#9E9E9E'
                              : '#9C27B0',
                        borderColor:
                          selectedDay.type === 'open'
                            ? 'rgba(255,87,34,0.3)'
                            : selectedDay.type === 'covered'
                              ? 'rgba(158,158,158,0.3)'
                              : 'rgba(156,39,176,0.3)',
                      }}
                    >
                      {selectedDay.type === 'open'
                        ? 'Open Shift'
                        : selectedDay.type === 'covered'
                          ? 'Covered'
                          : 'SwapMatch'}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-1.5 rounded-lg hover:bg-[#2a2a2a] transition-colors text-[#888] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-5 py-4">
              {selectedDay.shifts.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-[#666]">
                    {selectedDay.isWorkDay
                      ? 'You are scheduled to work this day.'
                      : 'No shifts for this day.'}
                  </p>
                  {selectedDay.isWorkDay && (
                    <Link
                      href={`/post-shift?date=${selectedDay.dateStr}`}
                      className="inline-block mt-3 px-4 py-2 text-sm font-medium bg-[#FF5722] hover:bg-[#E64A19] text-white rounded-lg transition"
                    >
                      Post this shift for trade?
                    </Link>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDay.shifts.map((shift) => (
                    <div
                      key={shift.id}
                      className="bg-[#222] rounded-lg border border-[#333] p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-[#f5f5f5]">
                          {shift.shift_type}
                        </span>
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor:
                              shift.status === 'open'
                                ? 'rgba(255,87,34,0.15)'
                                : shift.status === 'covered'
                                  ? 'rgba(158,158,158,0.15)'
                                  : 'rgba(244,67,54,0.15)',
                            color:
                              shift.status === 'open'
                                ? '#FF5722'
                                : shift.status === 'covered'
                                  ? '#9E9E9E'
                                  : '#F44336',
                          }}
                        >
                          {shift.status.charAt(0).toUpperCase() + shift.status.slice(1)}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-[#999]">
                        <p>
                          <span className="text-[#666]">Posted by:</span> {shift.poster_name}
                        </p>
                        <p>
                          <span className="text-[#666]">Station:</span> {shift.station} &middot;{' '}
                          <span className="text-[#666]">Rank:</span> {shift.rank}
                        </p>
                        {shift.coverer_name && (
                          <p>
                            <span className="text-[#666]">Covered by:</span> {shift.coverer_name}
                          </p>
                        )}
                        {shift.notes && (
                          <p className="mt-1.5 text-[#888] italic">{shift.notes}</p>
                        )}
                      </div>
                      {shift.poster_id === profile?.id && shift.status === 'open' && (
                        <button
                          onClick={() => setCancelTarget({ shiftId: shift.id, posterName: shift.poster_name })}
                          className="mt-2 w-full py-1.5 text-xs font-medium text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 transition"
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
