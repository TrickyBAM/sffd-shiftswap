'use client'

import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/contexts/ProfileContext'
import { useRouter } from 'next/navigation'
import { useState, useMemo } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  addDays,
  parse,
} from 'date-fns'
import {
  detectSchedulePattern,
  getWorkDatesForMonth,
  refinePattern,
  projectSchedule,
} from '@/lib/schedule'
import type { PatternResult } from '@/lib/schedule'
import { ChevronLeft, ChevronRight, Check, Calendar } from 'lucide-react'

// ---------------------------------------------------------------------------
// Calendar Grid Component
// ---------------------------------------------------------------------------

interface CalendarGridProps {
  month: Date
  selectedDates: Set<string>
  projectedDates?: Set<string>
  onToggleDate: (dateStr: string) => void
  selectable: boolean
}

function CalendarGrid({
  month,
  selectedDates,
  projectedDates,
  onToggleDate,
  selectable,
}: CalendarGridProps) {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const calStart = startOfWeek(monthStart)
  const calEnd = endOfWeek(monthEnd)

  const days = eachDayOfInterval({ start: calStart, end: calEnd })
  const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-2">
        {dayHeaders.map((d) => (
          <div
            key={d}
            className="text-center text-xs text-[#666] uppercase font-medium py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd')
          const inMonth = isSameMonth(day, month)
          const isSelected = selectedDates.has(dateStr)
          const isProjected = projectedDates?.has(dateStr) && !isSelected
          const today = isToday(day)
          const canSelect = selectable && inMonth

          return (
            <button
              key={dateStr}
              type="button"
              disabled={!canSelect}
              onClick={() => canSelect && onToggleDate(dateStr)}
              className={`
                aspect-square flex items-center justify-center text-sm rounded-full
                transition-all duration-150 relative
                ${!inMonth ? 'opacity-30 cursor-default' : ''}
                ${canSelect && !isSelected && !isProjected ? 'hover:bg-white/10 cursor-pointer' : ''}
                ${isSelected ? 'bg-[#2196F3] text-white font-semibold' : ''}
                ${isProjected ? 'bg-[#2196F3]/20 text-[#2196F3] border border-[#2196F3]/40 font-medium' : ''}
                ${!isSelected && !isProjected && inMonth ? 'text-white/80' : ''}
                ${today && !isSelected && !isProjected ? 'ring-1 ring-[#D32F2F] ring-offset-1 ring-offset-[#1a1a1a]' : ''}
                ${!canSelect && inMonth ? 'cursor-default' : ''}
              `}
            >
              {format(day, 'd')}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function ScheduleSetupPage() {
  const { profile } = useProfile()
  const router = useRouter()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Screen 1 state
  const [viewMonth, setViewMonth] = useState<Date>(new Date())
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())

  // Screen 2 state
  const [predictedMonth] = useState<Date>(addMonths(new Date(), 1))
  const [adjustedDates, setAdjustedDates] = useState<Set<string>>(new Set())
  const [pattern, setPattern] = useState<PatternResult | null>(null)

  // Toggle a date in a set (returns new Set)
  function toggleInSet(set: Set<string>, dateStr: string): Set<string> {
    const next = new Set(set)
    if (next.has(dateStr)) {
      next.delete(dateStr)
    } else {
      next.add(dateStr)
    }
    return next
  }

  // Screen 1 handlers
  function handleToggleSelected(dateStr: string) {
    setSelectedDates((prev) => toggleInSet(prev, dateStr))
  }

  function handlePrevMonth() {
    setViewMonth((m) => subMonths(m, 1))
  }

  function handleNextMonth() {
    setViewMonth((m) => addMonths(m, 1))
  }

  function handleGoToStep2() {
    // Detect pattern from selected dates
    const dates = Array.from(selectedDates)
      .sort()
      .map((s) => parse(s, 'yyyy-MM-dd', new Date()))

    const detected = detectSchedulePattern(dates)
    setPattern(detected)

    // Project next month
    const nextMonth = addMonths(new Date(), 1)
    const projectedDatesArr = getWorkDatesForMonth(
      detected.anchorDate,
      detected.gapPattern,
      nextMonth.getFullYear(),
      nextMonth.getMonth() + 1
    )

    setAdjustedDates(new Set(projectedDatesArr))
    setStep(2)
  }

  // Screen 2 handlers
  function handleToggleAdjusted(dateStr: string) {
    setAdjustedDates((prev) => toggleInSet(prev, dateStr))
  }

  async function handleConfirmAndSave() {
    if (!pattern) return
    setSaving(true)
    setError(null)

    try {
      const supabase = createClient()

      // Combine original selected dates + adjusted dates for refinement
      const originalDates = Array.from(selectedDates)
        .sort()
        .map((s) => parse(s, 'yyyy-MM-dd', new Date()))

      const confirmedDates = Array.from(adjustedDates)
        .sort()
        .map((s) => parse(s, 'yyyy-MM-dd', new Date()))

      // Refine pattern with both months of data
      const refined = refinePattern(originalDates, confirmedDates)

      // Project 12 months forward from anchor
      const anchor = parse(refined.anchorDate, 'yyyy-MM-dd', new Date())
      const endDate = addDays(anchor, 365 + 31) // ~13 months
      const allProjectedDates = projectSchedule(anchor, refined.gapPattern, endDate)
      const workDatesArray = allProjectedDates.map((d) => format(d, 'yyyy-MM-dd'))

      // Also include the user's manually entered dates
      const manualDates = [
        ...Array.from(selectedDates),
        ...Array.from(adjustedDates),
      ]
      const allDates = [...new Set([...manualDates, ...workDatesArray])].sort()

      const { error: upsertError } = await supabase.from('schedules').upsert({
        user_id: profile.id,
        work_dates: allDates,
        gap_pattern: refined.gapPattern,
        anchor_date: refined.anchorDate,
        setup_complete: true,
      })

      if (upsertError) {
        throw upsertError
      }

      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Screen 1: Select Work Days
  // ---------------------------------------------------------------------------
  if (step === 1) {
    return (
      <div className="min-h-screen bg-[#111111] text-white">
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold mb-2">
              Let&apos;s set up your schedule
            </h1>
            <p className="text-sm text-[#999]">
              Tap every day you work this month. Your regular shifts only, not
              overtime or trades.
            </p>
          </div>

          {/* Calendar Card */}
          <div className="bg-[#1a1a1a] rounded-2xl border border-[#2a2a2a] p-6 mb-6">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-white/70" />
              </button>
              <h2 className="text-lg font-semibold">
                {format(viewMonth, 'MMMM yyyy')}
              </h2>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <ChevronRight className="w-5 h-5 text-white/70" />
              </button>
            </div>

            <CalendarGrid
              month={viewMonth}
              selectedDates={selectedDates}
              onToggleDate={handleToggleSelected}
              selectable
            />
          </div>

          {/* Selection count */}
          <p className="text-center text-sm text-[#999] mb-4">
            {selectedDates.size} day{selectedDates.size !== 1 ? 's' : ''}{' '}
            selected
          </p>

          {/* Next button */}
          <button
            type="button"
            onClick={handleGoToStep2}
            disabled={selectedDates.size < 7}
            className={`
              w-full py-3.5 rounded-xl font-semibold text-white text-base transition-all
              ${
                selectedDates.size >= 7
                  ? 'bg-[#D32F2F] hover:bg-[#B71C1C] active:scale-[0.98]'
                  : 'bg-[#D32F2F]/30 text-white/40 cursor-not-allowed'
              }
            `}
          >
            Next
          </button>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Screen 2: Pattern Detection + Confirmation
  // ---------------------------------------------------------------------------
  if (step === 2) {
    return (
      <div className="min-h-screen bg-[#111111] text-white">
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold mb-2">
              We predicted your schedule
            </h1>
            <p className="text-sm text-[#999]">
              Does this look right? Tap to add or remove days if needed.
            </p>
          </div>

          {/* Low confidence warning */}
          {pattern && pattern.confidence < 0.7 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-4">
              <p className="text-yellow-400 text-sm">
                We couldn&apos;t detect a consistent pattern. Please
                double-check the predicted dates.
              </p>
            </div>
          )}

          {/* Predicted Calendar Card */}
          <div className="bg-[#1a1a1a] rounded-2xl border border-[#2a2a2a] p-6 mb-6">
            <h2 className="text-lg font-semibold text-center mb-4">
              {format(predictedMonth, 'MMMM yyyy')}
            </h2>

            <CalendarGrid
              month={predictedMonth}
              selectedDates={adjustedDates}
              onToggleDate={handleToggleAdjusted}
              selectable
            />
          </div>

          {/* Action count */}
          <p className="text-center text-sm text-[#999] mb-4">
            {adjustedDates.size} work day{adjustedDates.size !== 1 ? 's' : ''}{' '}
            for {format(predictedMonth, 'MMMM')}
          </p>

          {/* Error message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleConfirmAndSave}
              disabled={saving}
              className="w-full py-3.5 rounded-xl font-semibold text-white text-base
                bg-[#4CAF50] hover:bg-[#388E3C] active:scale-[0.98] transition-all
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Confirm & Save'}
            </button>

            <button
              type="button"
              onClick={() => setStep(1)}
              className="w-full py-3.5 rounded-xl font-semibold text-white/60 text-base
                bg-white/5 hover:bg-white/10 active:scale-[0.98] transition-all"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Screen 3: Success
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#111111] text-white flex items-center justify-center">
      <div className="max-w-lg mx-auto px-4 py-6 text-center">
        {/* Success icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 rounded-full bg-[#4CAF50]/20 flex items-center justify-center">
            <Check className="w-10 h-10 text-[#4CAF50]" strokeWidth={3} />
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-3">You&apos;re all set!</h1>
        <p className="text-[#999] text-sm mb-8">
          Your schedule has been saved and projected for the next 12 months.
        </p>

        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="w-full py-3.5 rounded-xl font-semibold text-white text-base
            bg-[#D32F2F] hover:bg-[#B71C1C] active:scale-[0.98] transition-all
            inline-flex items-center justify-center gap-2"
        >
          <Calendar className="w-5 h-5" />
          Go to Calendar
        </button>
      </div>
    </div>
  )
}
