'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/contexts/ProfileContext'
import {
  SFFD_HIERARCHY,
  DIVISIONS,
  getBattalionsForDivision,
  getStationsForBattalion,
  getStationLabel,
  getBattalionLabel,
  getDivisionName,
} from '@/lib/sffd'
import { Shift } from '@/lib/types'

const PAGE_SIZE = 20

export default function ShiftBoardPage() {
  const { profile } = useProfile()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Filters
  const [filterDivision, setFilterDivision] = useState<number | ''>('')
  const [filterBattalion, setFilterBattalion] = useState<number | ''>('')
  const [filterStation, setFilterStation] = useState<number | ''>('')

  // Confirmation dialog
  const [confirmShift, setConfirmShift] = useState<Shift | null>(null)
  const [accepting, setAccepting] = useState(false)

  // Cancel dialog
  const [cancelShift, setCancelShift] = useState<Shift | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  // Cascading filter options
  const availableBattalions = filterDivision !== ''
    ? getBattalionsForDivision(filterDivision)
    : SFFD_HIERARCHY.flatMap(d => d.battalions.map(b => b.id))

  const availableStations = filterBattalion !== ''
    ? getStationsForBattalion(filterBattalion)
    : filterDivision !== ''
      ? getBattalionsForDivision(filterDivision).flatMap(bId => getStationsForBattalion(bId))
      : []

  // Reset child filters when parent changes
  const handleDivisionChange = (val: string) => {
    const numVal = val === '' ? '' : Number(val)
    setFilterDivision(numVal as number | '')
    setFilterBattalion('')
    setFilterStation('')
  }

  const handleBattalionChange = (val: string) => {
    const numVal = val === '' ? '' : Number(val)
    setFilterBattalion(numVal as number | '')
    setFilterStation('')
  }

  const handleStationChange = (val: string) => {
    const numVal = val === '' ? '' : Number(val)
    setFilterStation(numVal as number | '')
  }

  const fetchShifts = useCallback(async (offset = 0, append = false) => {
    if (!append) setLoading(true)
    else setLoadingMore(true)

    try {
      const supabase = createClient()
      let query = supabase
        .from('shifts')
        .select('*')
        .eq('status', 'open')
        .order('date', { ascending: true })
        .range(offset, offset + PAGE_SIZE)

      if (filterDivision !== '') {
        query = query.eq('division', filterDivision)
      }
      if (filterBattalion !== '') {
        query = query.eq('battalion', filterBattalion)
      }
      if (filterStation !== '') {
        query = query.eq('station', filterStation)
      }

      const { data, error: fetchError } = await query

      if (fetchError) throw fetchError

      const fetched = (data ?? []) as Shift[]

      if (append) {
        setShifts(prev => [...prev, ...fetched])
      } else {
        setShifts(fetched)
      }

      setHasMore(fetched.length > PAGE_SIZE)
      // Trim to PAGE_SIZE (we fetched PAGE_SIZE + 1 to check for more)
      if (fetched.length > PAGE_SIZE) {
        if (append) {
          setShifts(prev => prev.slice(0, prev.length - 1))
        } else {
          setShifts(fetched.slice(0, PAGE_SIZE))
        }
      }

      setError(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load shifts'
      setError(message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filterDivision, filterBattalion, filterStation])

  // Initial load & filter changes
  useEffect(() => {
    fetchShifts()
  }, [fetchShifts])

  // Real-time subscription
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('shifts-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts' },
        () => {
          // Refetch on any change
          fetchShifts()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchShifts])

  const handleLoadMore = () => {
    fetchShifts(shifts.length, true)
  }

  const handleAccept = async (shift: Shift) => {
    if (!profile) return
    setAccepting(true)

    try {
      const supabase = createClient()

      const { error: rpcError } = await supabase.rpc('accept_shift', {
        p_shift_id: shift.id,
        p_coverer_id: profile.id,
        p_coverer_name: profile.full_name,
      })

      if (rpcError) throw rpcError

      setConfirmShift(null)
      showToast('Shift accepted successfully!', 'success')
      fetchShifts()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to accept shift'
      showToast(message, 'error')
    } finally {
      setAccepting(false)
    }
  }

  const handleCancel = async (shift: Shift) => {
    if (!profile) return
    setCancelling(true)

    try {
      const supabase = createClient()

      const { error: updateError } = await supabase
        .from('shifts')
        .update({ status: 'cancelled' })
        .eq('id', shift.id)
        .eq('poster_id', profile.id)

      if (updateError) throw updateError

      await supabase
        .from('profiles')
        .update({
          trade_requested: Math.max(0, profile.trade_requested - 1),
          trade_outstanding: Math.max(0, profile.trade_outstanding - 1),
        })
        .eq('id', profile.id)

      setCancelShift(null)
      showToast('Shift cancelled successfully.', 'success')
      fetchShifts()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to cancel shift'
      showToast(message, 'error')
    } finally {
      setCancelling(false)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Shift Board</h1>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green-900/60 text-green-200 border border-green-700'
              : 'bg-red-900/60 text-red-200 border border-red-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Division */}
        <select
          value={filterDivision}
          onChange={(e) => handleDivisionChange(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#333] text-[#f5f5f5] text-sm focus:outline-none focus:border-[#D32F2F] transition-colors"
        >
          <option value="">All Divisions</option>
          {DIVISIONS.map((divId) => (
            <option key={divId} value={divId}>
              {getDivisionName(divId)}
            </option>
          ))}
        </select>

        {/* Battalion */}
        <select
          value={filterBattalion}
          onChange={(e) => handleBattalionChange(e.target.value)}
          disabled={filterDivision === ''}
          className="px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#333] text-[#f5f5f5] text-sm focus:outline-none focus:border-[#D32F2F] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value="">All Battalions</option>
          {availableBattalions.map((bId) => (
            <option key={bId} value={bId}>
              {getBattalionLabel(bId)}
            </option>
          ))}
        </select>

        {/* Station */}
        <select
          value={filterStation}
          onChange={(e) => handleStationChange(e.target.value)}
          disabled={filterBattalion === ''}
          className="px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#333] text-[#f5f5f5] text-sm focus:outline-none focus:border-[#D32F2F] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value="">All Stations</option>
          {availableStations.map((sId) => (
            <option key={sId} value={sId}>
              {getStationLabel(sId)}
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#D32F2F]" />
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-200 text-sm mb-4">
          {error}
          <button
            onClick={() => fetchShifts()}
            className="ml-3 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && shifts.length === 0 && (
        <div className="text-center py-20">
          <div className="text-5xl mb-4 opacity-30">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-[#666]"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <p className="text-[#888] text-lg font-medium">No open shifts available</p>
          <p className="text-[#666] text-sm mt-1">Check back later or adjust your filters</p>
        </div>
      )}

      {/* Shift Cards */}
      {!loading && !error && shifts.length > 0 && (
        <div className="space-y-3">
          {shifts.map((shift) => {
            const isSwapMatch = shift.return_dates && shift.return_dates.length > 0
            const isOwnShift = profile?.id === shift.poster_id
            const borderColor = isSwapMatch ? '#9C27B0' : '#FF5722'

            return (
              <div
                key={shift.id}
                className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-[#2a2a2a]"
                style={{ borderLeftWidth: '4px', borderLeftColor: borderColor }}
              >
                <div className="p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-[#f5f5f5]">{shift.poster_name}</p>
                      <p className="text-xs text-[#888] mt-0.5">
                        {shift.rank} &middot; {getStationLabel(shift.station)}
                      </p>
                    </div>
                    {isSwapMatch && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-[#9C27B0]/20 text-[#CE93D8] px-2 py-0.5 rounded-full">
                        SwapMatch
                      </span>
                    )}
                  </div>

                  {/* Shift info */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-3">
                    <span className="text-[#ccc]">
                      <span className="text-[#888]">Date:</span>{' '}
                      {formatDate(shift.date)}
                    </span>
                    <span className="text-[#ccc]">
                      <span className="text-[#888]">Type:</span>{' '}
                      {shift.shift_type}
                    </span>
                  </div>

                  {/* Notes */}
                  {shift.notes && (
                    <p className="text-sm text-[#999] mb-3 italic">
                      &ldquo;{shift.notes}&rdquo;
                    </p>
                  )}

                  {/* Return dates for SwapMatch */}
                  {isSwapMatch && shift.return_dates.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-[#888] mb-1">Return dates offered:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {shift.return_dates.map((rd) => (
                          <span
                            key={rd}
                            className="text-xs bg-[#9C27B0]/15 text-[#CE93D8] px-2 py-0.5 rounded"
                          >
                            {formatDate(rd)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action button */}
                  {isOwnShift ? (
                    <button
                      onClick={() => setCancelShift(shift)}
                      className="w-full py-2 rounded-lg border border-red-400/30 text-red-400 text-sm font-semibold hover:bg-red-400/10 transition-colors"
                    >
                      Cancel Shift
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmShift(shift)}
                      className="w-full py-2 rounded-lg bg-[#D32F2F] text-white text-sm font-semibold hover:bg-[#B71C1C] transition-colors"
                    >
                      Accept
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Load More */}
      {!loading && hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="px-6 py-2.5 rounded-xl bg-[#1a1a1a] border border-[#333] text-[#ccc] text-sm font-medium hover:border-[#D32F2F] hover:text-white disabled:opacity-50 transition-colors"
          >
            {loadingMore ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                Loading...
              </span>
            ) : (
              'Load More'
            )}
          </button>
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      {cancelShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-[#1a1a1a] rounded-xl border border-[#333] max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-[#f5f5f5] mb-2">Cancel Shift</h2>
            <p className="text-sm text-[#999] mb-1">
              Are you sure you want to cancel this shift?
            </p>
            <p className="text-sm text-[#999] mb-4">
              <span className="text-[#ccc]">{formatDate(cancelShift.date)}</span>{' '}
              &middot; {cancelShift.shift_type} &middot; {getStationLabel(cancelShift.station)}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelShift(null)}
                disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl bg-[#252525] border border-[#444] text-[#ccc] text-sm font-medium hover:bg-[#333] transition-colors"
              >
                Keep Shift
              </button>
              <button
                onClick={() => handleCancel(cancelShift)}
                disabled={cancelling}
                className="flex-1 py-2.5 rounded-xl bg-[#D32F2F] text-white text-sm font-semibold hover:bg-[#B71C1C] disabled:opacity-50 transition-colors"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-[#1a1a1a] rounded-xl border border-[#333] max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-[#f5f5f5] mb-2">
              Confirm Accept
            </h2>
            <p className="text-sm text-[#999] mb-1">
              You are about to accept a shift from{' '}
              <span className="text-[#f5f5f5] font-medium">{confirmShift.poster_name}</span>.
            </p>
            <p className="text-sm text-[#999] mb-4">
              <span className="text-[#ccc]">{formatDate(confirmShift.date)}</span>{' '}
              &middot; {confirmShift.shift_type} &middot; {getStationLabel(confirmShift.station)}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmShift(null)}
                disabled={accepting}
                className="flex-1 py-2.5 rounded-xl bg-[#252525] border border-[#444] text-[#ccc] text-sm font-medium hover:bg-[#333] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAccept(confirmShift)}
                disabled={accepting}
                className="flex-1 py-2.5 rounded-xl bg-[#D32F2F] text-white text-sm font-semibold hover:bg-[#B71C1C] disabled:opacity-50 transition-colors"
              >
                {accepting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                    Accepting...
                  </span>
                ) : (
                  'Accept Shift'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
