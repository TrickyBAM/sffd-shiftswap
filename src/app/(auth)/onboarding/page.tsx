'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { createClient } from '@/lib/supabase/client'
import {
  RANKS,
  POSITION_TYPES,
  getStationsForBattalion,
  getBattalionsForDivision,
  getStationLabel,
  getBattalionLabel,
  getDivisionName,
  DIVISIONS,
} from '@/lib/sffd'

const onboardingSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  rank: z.enum(RANKS, { message: 'Please select a rank' }),
  position_type: z.enum(POSITION_TYPES, { message: 'Please select a position type' }),
  division: z.number().min(1, 'Please select a division'),
  battalion: z.number().min(1, 'Please select a battalion'),
  station: z.number().min(1, 'Please select a station'),
  tour: z.number().min(1, 'Tour must be between 1 and 31').max(31, 'Tour must be between 1 and 31'),
  phone: z.string().optional(),
})

type OnboardingForm = z.infer<typeof onboardingSchema>

export default function OnboardingPage() {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      full_name: '',
      division: 0,
      battalion: 0,
      station: 0,
      tour: undefined,
      phone: '',
    },
  })

  const selectedDivision = useWatch({ control, name: 'division' })
  const selectedBattalion = useWatch({ control, name: 'battalion' })

  const battalions = selectedDivision ? getBattalionsForDivision(selectedDivision) : []
  const stations = selectedBattalion ? getStationsForBattalion(selectedBattalion) : []

  // Reset battalion and station when division changes
  useEffect(() => {
    setValue('battalion', 0)
    setValue('station', 0)
  }, [selectedDivision, setValue])

  // Reset station when battalion changes
  useEffect(() => {
    setValue('station', 0)
  }, [selectedBattalion, setValue])

  // Prefill name from user metadata
  useEffect(() => {
    async function loadUser() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user?.user_metadata?.full_name) {
        setValue('full_name', user.user_metadata.full_name)
      }
    }
    loadUser()
  }, [setValue])

  async function onSubmit(data: OnboardingForm) {
    setServerError(null)
    const supabase = createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setServerError('You must be logged in to complete onboarding.')
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: data.full_name,
        rank: data.rank,
        position_type: data.position_type,
        division: data.division,
        battalion: data.battalion,
        station: data.station,
        tour: data.tour,
        phone: data.phone || null,
        profile_complete: true,
      })
      .eq('id', user.id)

    if (error) {
      setServerError(error.message)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  const selectClasses =
    'w-full px-4 py-2.5 bg-[#1a1a26] border border-white/[0.06] rounded-xl text-[#F0F0F5] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 focus:border-transparent transition appearance-none'
  const inputClasses =
    'w-full px-4 py-2.5 bg-[#1a1a26] border border-white/[0.06] rounded-xl text-[#F0F0F5] placeholder-[#555570] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 focus:border-transparent transition'

  return (
    <div className="bg-[#12121a] rounded-2xl shadow-xl border border-white/[0.06] p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#D32F2F]/10 mb-4">
          <svg
            className="w-8 h-8 text-[#D32F2F]"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[#F0F0F5] font-display">Complete Your Profile</h1>
        <p className="text-[#8888A0] mt-1 text-sm">
          Tell us about your assignment at SFFD
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {serverError && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">
            {serverError}
          </div>
        )}

        {/* Full Name */}
        <div>
          <label htmlFor="full_name" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Full Name
          </label>
          <input
            id="full_name"
            type="text"
            {...register('full_name')}
            className={inputClasses}
            placeholder="John Smith"
          />
          {errors.full_name && (
            <p className="mt-1 text-sm text-red-400">{errors.full_name.message}</p>
          )}
        </div>

        {/* Rank */}
        <div>
          <label htmlFor="rank" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Rank
          </label>
          <select id="rank" {...register('rank')} className={selectClasses} defaultValue="">
            <option value="" disabled>
              Select rank
            </option>
            {RANKS.map((rank) => (
              <option key={rank} value={rank}>
                {rank}
              </option>
            ))}
          </select>
          {errors.rank && (
            <p className="mt-1 text-sm text-red-400">{errors.rank.message}</p>
          )}
        </div>

        {/* Position Type */}
        <div>
          <label htmlFor="position_type" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Position Type
          </label>
          <select id="position_type" {...register('position_type')} className={selectClasses} defaultValue="">
            <option value="" disabled>
              Select position type
            </option>
            {POSITION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {errors.position_type && (
            <p className="mt-1 text-sm text-red-400">{errors.position_type.message}</p>
          )}
        </div>

        {/* Division */}
        <div>
          <label htmlFor="division" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Division
          </label>
          <select id="division" {...register('division', { valueAsNumber: true })} className={selectClasses}>
            <option value={0} disabled>
              Select division
            </option>
            {DIVISIONS.map((divId) => (
              <option key={divId} value={divId}>
                {getDivisionName(divId)}
              </option>
            ))}
          </select>
          {errors.division && (
            <p className="mt-1 text-sm text-red-400">{errors.division.message}</p>
          )}
        </div>

        {/* Battalion */}
        <div>
          <label htmlFor="battalion" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Battalion
          </label>
          <select
            id="battalion"
            {...register('battalion', { valueAsNumber: true })}
            className={selectClasses}
            disabled={!selectedDivision}
          >
            <option value={0} disabled>
              {selectedDivision ? 'Select battalion' : 'Select a division first'}
            </option>
            {battalions.map((batId) => (
              <option key={batId} value={batId}>
                {getBattalionLabel(batId)}
              </option>
            ))}
          </select>
          {errors.battalion && (
            <p className="mt-1 text-sm text-red-400">{errors.battalion.message}</p>
          )}
        </div>

        {/* Station */}
        <div>
          <label htmlFor="station" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Station
          </label>
          <select
            id="station"
            {...register('station', { valueAsNumber: true })}
            className={selectClasses}
            disabled={!selectedBattalion}
          >
            <option value={0} disabled>
              {selectedBattalion ? 'Select station' : 'Select a battalion first'}
            </option>
            {stations.map((stationId) => (
              <option key={stationId} value={stationId}>
                {getStationLabel(stationId)}
              </option>
            ))}
          </select>
          {errors.station && (
            <p className="mt-1 text-sm text-red-400">{errors.station.message}</p>
          )}
        </div>

        {/* Tour */}
        <div>
          <label htmlFor="tour" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Tour
          </label>
          <select id="tour" {...register('tour', { valueAsNumber: true })} className={selectClasses}>
            <option value={0} disabled>
              Select tour (1-31)
            </option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((t) => (
              <option key={t} value={t}>
                Tour {t}
              </option>
            ))}
          </select>
          {errors.tour && (
            <p className="mt-1 text-sm text-red-400">{errors.tour.message}</p>
          )}
        </div>

        {/* Phone */}
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-[#8888A0] mb-1.5">
            Phone <span className="text-[#555570]">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            {...register('phone')}
            className={inputClasses}
            placeholder="(415) 555-1234"
          />
          {errors.phone && (
            <p className="mt-1 text-sm text-red-400">{errors.phone.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-[#D32F2F] hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed text-[#F0F0F5] font-semibold rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/50 focus:ring-offset-2 focus:ring-offset-[#12121a]"
        >
          {isSubmitting ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving profile...
            </span>
          ) : (
            'Complete Profile'
          )}
        </button>
      </form>
    </div>
  )
}
