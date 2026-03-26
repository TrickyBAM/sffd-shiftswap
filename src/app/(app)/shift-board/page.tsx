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

  const [filterDivision, setFilterDivision] = useState<number | ''>('')
  const [filterBattalion, setFilterBattalion] = useState<number | ''>('')
  const [filterStation, setFilterStation] = useState<number | ''>('')

  const [confirmShift, setConfirmShift] = useState<Shift | null>(null)
  const [accepting, setAccepting] = useState(false)

  const [cancelShift, setCancelShift] = useState<Shift | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const availableBattalions = filterDivision !== ''
    ? getBattalionsForDivision(filterDivision)
    : SFFD_HIERARCHY.flatMap(d => d.battalions.map(b => b.id))

  const availableStations = filterBattalion !== ''
    ? getStationsForBattalion(filterBattalion)
    : filterDivision !== ''
      ? getBattalionsForDivision(filterDivision).flatMap(bId => getStationsForBattalion(bId))
      : []

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

      if (filterDivision !== '') query = query.eq('division', filterDivision)
      if (filterBattalion !== '') query = query.eq('battalion', filterBattalion)
      if (filterStation !== '') query = query.eq('station', filterStation)

      const { data, error: fetchError } = await query
      if (fetchError) throw fetchError

      const fetched = (data ?? []) as Shift[]

      if (append) setShifts(prev => [...prev, ...fetched])
      else setShifts(fetched)

      setHasMore(fetched.length > PAGE_SIZE)
      if (fetched.length > PAGE_SIZE) {
        if (append) setShifts(prev => prev.slice(0, prev.length - 1))
        else setShifts(fetched.slice(0, PAGE_SIZE))
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

  useEffect(() => { fetchShifts() }, [fetchShifts])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('shifts-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => { fetchShifts() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchShifts])

  const handleLoadMore = () => { fetchShifts(shifts.length, true) }

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
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const selectClasses = "px-3 py-2 rounded-xl bg-[#12121a] border border-white/[0.06] text-[#F0F0F5] text-sm focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 transition disabled:opacity-40 disabled:cursor-not-allowed"

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="font-display text-3xl tracking-wide mb-6 animate-fade-in-up">SHIFT BOARD</h1>

      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium ${
          toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-6 animate-fade-in-up delay-1">
        <select value={filterDivision} onChange={(e) => handleDivisionChange(e.target.value)} className={selectClasses}>
          <option value="">All Divisions</option>
          {DIVISIONS.map((divId) => <option key={divId} value={divId}>{getDivisionName(divId)}</option>)}
        </select>
        <select value={filterBattalion} onChange={(e) => handleBattalionChange(e.target.value)} disabled={filterDivision === ''} className={selectClasses}>
          <option value="">All Battalions</option>
          {availableBattalions.map((bId) => <option key={bId} value={bId}>{getBattalionLabel(bId)}</option>)}
        </select>
        <select value={filterStation} onChange={(e) => handleStationChange(e.target.value)} disabled={filterBattalion === ''} className={selectClasses}>
          <option value="">All Stations</option>
          {availableStations.map((sId) => <option key={sId} value={sId}>{getStationLabel(sId)}</option>)}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-[#D32F2F]" />
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
          {error}
          <button onClick={() => fetchShifts()} className="ml-3 underline hover:no-underline">Retry</button>
        </div>
      )}

      {!loading && !error && shifts.length === 0 && (
        <div className="text-center py-20">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-[#555570] mb-4"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <p className="text-[#8888A0] text-lg font-medium">No open shifts available</p>
          <p className="text-[#555570] text-sm mt-1">Check back later or adjust your filters</p>
        </div>
      )}

      {!loading && !error && shifts.length > 0 && (
        <div className="space-y-3 animate-fade-in-up delay-2">
          {shifts.map((shift) => {
            const isSwapMatch = shift.return_dates && shift.return_dates.length > 0
            const isOwnShift = profile?.id === shift.poster_id
            const borderColor = isSwapMatch ? '#9C6AFF' : '#FF6B35'

            return (
              <div
                key={shift.id}
                className="bg-[#12121a] rounded-2xl overflow-hidden border border-white/[0.06] card-hover"
                style={{ borderLeftWidth: '4px', borderLeftColor: borderColor }}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#1a1a26] flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-[#8888A0]">
                          {shift.poster_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-[#F0F0F5]">{shift.poster_name}</p>
                        <p className="text-xs text-[#555570] mt-0.5">
                          {shift.rank} &middot; {getStationLabel(shift.station)}
                        </p>
                      </div>
                    </div>
                    {isSwapMatch && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-[#9C6AFF]/15 text-[#9C6AFF] px-2 py-0.5 rounded-full">
                        SwapMatch
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-3">
                    <span className="text-[#F0F0F5]">
                      <span className="text-[#555570]">Date:</span> {formatDate(shift.date)}
                    </span>
                    <span className="text-[#F0F0F5]">
                      <span className="text-[#555570]">Type:</span> {shift.shift_type}
                    </span>
                  </div>

                  {shift.notes && (
                    <p className="text-sm text-[#8888A0] mb-3 italic">&ldquo;{shift.notes}&rdquo;</p>
                  )}

                  {isSwapMatch && shift.return_dates.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-[#555570] mb-1">Return dates offered:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {shift.return_dates.map((rd) => (
                          <span key={rd} className="text-xs bg-[#9C6AFF]/10 text-[#9C6AFF] px-2 py-0.5 rounded">{formatDate(rd)}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {isOwnShift ? (
                    <button onClick={() => setCancelShift(shift)} className="w-full py-2 rounded-xl border border-red-400/20 text-red-400 text-sm font-semibold hover:bg-red-400/10 transition-colors">
                      Cancel Shift
                    </button>
                  ) : (
                    <button onClick={() => setConfirmShift(shift)} className="w-full py-2 rounded-xl bg-[#D32F2F] text-white text-sm font-semibold hover:bg-[#B71C1C] transition-colors">
                      Accept
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && hasMore && (
        <div className="mt-6 text-center">
          <button onClick={handleLoadMore} disabled={loadingMore} className="px-6 py-2.5 rounded-xl bg-[#12121a] border border-white/[0.06] text-[#8888A0] text-sm font-medium hover:border-[#D32F2F]/50 hover:text-[#F0F0F5] disabled:opacity-50 transition-colors">
            {loadingMore ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}

      {cancelShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] max-w-sm w-full p-6">
            <h2 className="font-display text-2xl text-[#F0F0F5] mb-2">CANCEL SHIFT</h2>
            <p className="text-sm text-[#8888A0] mb-1">Are you sure you want to cancel this shift?</p>
            <p className="text-sm text-[#8888A0] mb-4">
              <span className="text-[#F0F0F5]">{formatDate(cancelShift.date)}</span> &middot; {cancelShift.shift_type} &middot; {getStationLabel(cancelShift.station)}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setCancelShift(null)} disabled={cancelling} className="flex-1 py-2.5 rounded-xl bg-[#1a1a26] border border-white/[0.06] text-[#8888A0] text-sm font-medium hover:bg-[#222233] transition-colors">Keep Shift</button>
              <button onClick={() => handleCancel(cancelShift)} disabled={cancelling} className="flex-1 py-2.5 rounded-xl bg-[#D32F2F] text-white text-sm font-semibold hover:bg-[#B71C1C] disabled:opacity-50 transition-colors">{cancelling ? 'Cancelling...' : 'Yes, Cancel'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] max-w-sm w-full p-6">
            <h2 className="font-display text-2xl text-[#F0F0F5] mb-2">CONFIRM ACCEPT</h2>
            <p className="text-sm text-[#8888A0] mb-1">
              You are about to accept a shift from <span className="text-[#F0F0F5] font-medium">{confirmShift.poster_name}</span>.
            </p>
            <p className="text-sm text-[#8888A0] mb-4">
              <span className="text-[#F0F0F5]">{formatDate(confirmShift.date)}</span> &middot; {confirmShift.shift_type} &middot; {getStationLabel(confirmShift.station)}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmShift(null)} disabled={accepting} className="flex-1 py-2.5 rounded-xl bg-[#1a1a26] border border-white/[0.06] text-[#8888A0] text-sm font-medium hover:bg-[#222233] transition-colors">Cancel</button>
              <button onClick={() => handleAccept(confirmShift)} disabled={accepting} className="flex-1 py-2.5 rounded-xl bg-[#D32F2F] text-white text-sm font-semibold hover:bg-[#B71C1C] disabled:opacity-50 transition-colors">
                {accepting ? 'Accepting...' : 'Accept Shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
