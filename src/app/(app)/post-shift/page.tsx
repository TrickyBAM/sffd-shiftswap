'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/contexts/ProfileContext'
import { SHIFT_TYPES } from '@/lib/sffd'
import type { ShiftType, AcceptLimitType } from '@/lib/types'

const postShiftSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  shift_type: z.enum(['24-Hour', '12-Hour Day', '12-Hour Night']),
  notes: z.string().optional(),
  swap_match: z.boolean(),
  return_dates: z.array(z.object({ date: z.string().min(1, 'Date is required') })).optional(),
  accept_limit_type: z.enum(['', 'station', 'battalion', 'division']),
})

type PostShiftForm = z.infer<typeof postShiftSchema>

export default function PostShiftPage() {
  const { profile } = useProfile()
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    formState: { errors },
  } = useForm<PostShiftForm>({
    defaultValues: {
      date: '',
      shift_type: '24-Hour',
      notes: '',
      swap_match: false,
      return_dates: [],
      accept_limit_type: '',
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'return_dates',
  })

  const swapMatchEnabled = watch('swap_match')

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const onSubmit = async (data: PostShiftForm) => {
    setSubmitting(true)
    try {
      const supabase = createClient()

      const returnDates = data.swap_match && data.return_dates
        ? data.return_dates.map(rd => rd.date)
        : []

      const { error } = await supabase.from('shifts').insert({
        poster_id: profile.id,
        poster_name: profile.full_name,
        division: profile.division,
        battalion: profile.battalion,
        station: profile.station,
        rank: profile.rank,
        date: data.date,
        shift_type: data.shift_type as ShiftType,
        status: 'open',
        return_dates: returnDates,
        accept_limit_type: data.accept_limit_type as AcceptLimitType,
        notes: data.notes || null,
      })

      if (error) throw error

      // Increment trade_requested and trade_outstanding on the profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          trade_requested: profile.trade_requested + 1,
          trade_outstanding: profile.trade_outstanding + 1,
        })
        .eq('id', profile.id)

      if (profileError) throw profileError

      reset()
      showToast('Shift posted successfully!', 'success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to post shift'
      showToast(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 animate-fade-in-up">
      <h1 className="font-display text-3xl mb-6 text-[#F0F0F5]">POST A SHIFT</h1>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {toast.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-[#8888A0] mb-1">
            Shift Date
          </label>
          <input
            type="date"
            {...register('date', { required: 'Date is required' })}
            className="w-full px-3 py-2.5 rounded-xl bg-[#12121a] border border-white/[0.06] text-[#F0F0F5] focus:outline-none focus:border-[#D32F2F] transition-colors"
          />
          {errors.date && (
            <p className="mt-1 text-sm text-red-400">{errors.date.message}</p>
          )}
        </div>

        {/* Shift Type */}
        <div>
          <label className="block text-sm font-medium text-[#8888A0] mb-1">
            Shift Type
          </label>
          <select
            {...register('shift_type')}
            className="w-full px-3 py-2.5 rounded-xl bg-[#12121a] border border-white/[0.06] text-[#F0F0F5] focus:outline-none focus:border-[#D32F2F] transition-colors"
          >
            {SHIFT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-[#8888A0] mb-1">
            Notes <span className="text-[#555570]">(optional)</span>
          </label>
          <textarea
            {...register('notes')}
            rows={3}
            placeholder="Any additional details..."
            className="w-full px-3 py-2.5 rounded-xl bg-[#12121a] border border-white/[0.06] text-[#F0F0F5] placeholder-[#555570] focus:outline-none focus:border-[#D32F2F] transition-colors resize-none"
          />
        </div>

        {/* SwapMatch Toggle */}
        <div className="bg-[#12121a] rounded-xl p-4 border border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-[#F0F0F5]">SwapMatch</p>
              <p className="text-xs text-[#555570] mt-0.5">
                Offer specific return dates for a direct trade
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                {...register('swap_match')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#1a1a26] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#9C6AFF]" />
            </label>
          </div>

          {/* Return Dates */}
          {swapMatchEnabled && (
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-[#8888A0]">
                Return Dates You Would Accept
              </label>
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-2">
                  <input
                    type="date"
                    {...register(`return_dates.${index}.date` as const, {
                      required: 'Date is required',
                    })}
                    className="flex-1 px-3 py-2 rounded-xl bg-[#1a1a26] border border-white/[0.06] text-[#F0F0F5] focus:outline-none focus:border-[#9C6AFF] transition-colors text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="p-2 text-[#555570] hover:text-red-400 transition-colors"
                    aria-label="Remove date"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => append({ date: '' })}
                className="w-full py-2 rounded-lg border border-dashed border-[#555570] text-sm text-[#8888A0] hover:border-[#9C6AFF] hover:text-[#9C6AFF] transition-colors"
              >
                + Add Return Date
              </button>
              {errors.return_dates && (
                <p className="text-sm text-red-400">Please fill in all return dates</p>
              )}
            </div>
          )}
        </div>

        {/* Accept Limit */}
        <div>
          <label className="block text-sm font-medium text-[#8888A0] mb-1">
            Who Can Accept
          </label>
          <select
            {...register('accept_limit_type')}
            className="w-full px-3 py-2.5 rounded-xl bg-[#12121a] border border-white/[0.06] text-[#F0F0F5] focus:outline-none focus:border-[#D32F2F] transition-colors"
          >
            <option value="">Anyone in SFFD</option>
            <option value="station">Same Station Only</option>
            <option value="battalion">Same Battalion Only</option>
            <option value="division">Same Division Only</option>
          </select>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-[#D32F2F] text-[#F0F0F5] font-semibold hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
              Posting...
            </span>
          ) : (
            'Post Shift'
          )}
        </button>
      </form>
    </div>
  )
}
