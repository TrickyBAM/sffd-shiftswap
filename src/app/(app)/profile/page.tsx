'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/contexts/ProfileContext'
import {
  RANKS,
  POSITION_TYPES,
  DIVISIONS,
  getBattalionsForDivision,
  getStationsForBattalion,
  getStationLabel,
  getBattalionLabel,
  getDivisionName,
} from '@/lib/sffd'

const profileSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  rank: z.enum(['Firefighter', 'Paramedic', 'Lieutenant', 'Captain', 'Battalion Chief']),
  position_type: z.enum(['Firefighter', 'Paramedic', 'Officer']),
  tour: z.coerce.number().min(1).max(31),
  division: z.coerce.number(),
  battalion: z.coerce.number(),
  station: z.coerce.number(),
  phone: z.string().optional(),
  email: z.string().email('Please enter a valid email'),
})

type ProfileFormValues = z.infer<typeof profileSchema>

export default function ProfilePage() {
  const { profile } = useProfile()
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema) as never,
    defaultValues: {
      full_name: profile?.full_name ?? '',
      rank: profile?.rank ?? 'Firefighter',
      position_type: profile?.position_type ?? 'Firefighter',
      tour: profile?.tour ?? 1,
      division: profile?.division ?? 2,
      battalion: profile?.battalion ?? 1,
      station: profile?.station ?? 2,
      phone: profile?.phone ?? '',
      email: profile?.email ?? '',
    },
  })

  const watchDivision = watch('division')
  const watchBattalion = watch('battalion')
  const battalions = getBattalionsForDivision(Number(watchDivision))
  const stations = getStationsForBattalion(Number(watchBattalion))

  function handleDivisionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const divId = Number(e.target.value)
    setValue('division', divId)
    const bats = getBattalionsForDivision(divId)
    if (bats.length > 0) {
      setValue('battalion', bats[0])
      const sts = getStationsForBattalion(bats[0])
      setValue('station', sts.length > 0 ? sts[0] : 0)
    } else {
      setValue('battalion', 0)
      setValue('station', 0)
    }
  }

  function handleBattalionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const batId = Number(e.target.value)
    setValue('battalion', batId)
    const sts = getStationsForBattalion(batId)
    setValue('station', sts.length > 0 ? sts[0] : 0)
  }

  async function onSubmit(data: ProfileFormValues) {
    if (!profile) return
    setSaving(true)
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: data.full_name,
        rank: data.rank,
        position_type: data.position_type,
        tour: data.tour,
        division: data.division,
        battalion: data.battalion,
        station: data.station,
        phone: data.phone || null,
        email: data.email,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id)

    setSaving(false)

    if (error) {
      setServerError(error.message)
      return
    }

    setIsEditing(false)
    router.refresh()
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleCancel() {
    if (!profile) return
    reset({
      full_name: profile.full_name,
      rank: profile.rank,
      position_type: profile.position_type,
      tour: profile.tour,
      division: profile.division,
      battalion: profile.battalion,
      station: profile.station,
      phone: profile.phone ?? '',
      email: profile.email,
    })
    setIsEditing(false)
    setServerError(null)
  }

  const tradeStats = [
    { label: 'Requested', value: profile.trade_requested, color: '#D32F2F' },
    { label: 'Filled', value: profile.trade_filled, color: '#34D399' },
    { label: 'Outstanding', value: profile.trade_outstanding, color: '#FF6B35' },
    { label: 'Earned', value: profile.trade_earned, color: '#4A9FFF' },
  ]

  const inputClasses =
    'w-full px-4 py-2.5 bg-[#1a1a26] border border-white/[0.06] rounded-xl text-[#F0F0F5] placeholder-[#555570] focus:outline-none focus:ring-2 focus:ring-[#D32F2F] focus:border-transparent transition'
  const selectClasses =
    'w-full px-4 py-2.5 bg-[#1a1a26] border border-white/[0.06] rounded-xl text-[#F0F0F5] focus:outline-none focus:ring-2 focus:ring-[#D32F2F] focus:border-transparent transition appearance-none'
  const labelClasses = 'block text-sm font-medium text-[#8888A0] mb-1.5'

  return (
    <div className="min-h-screen px-4 py-6 pb-24">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Profile Header */}
        <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-6 animate-fade-in-up">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#D32F2F] to-[#FF6B35] flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-bold text-[#F0F0F5]">
                {profile.full_name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[#F0F0F5] truncate">{profile.full_name}</h1>
              <p className="text-[#8888A0] text-sm">{profile.rank}</p>
              <p className="text-[#555570] text-sm">{getStationLabel(profile.station)}</p>
            </div>
          </div>
        </div>

        {/* Trade Score */}
        <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-6 animate-fade-in-up delay-1">
          <h2 className="text-lg font-semibold font-display text-[#F0F0F5] mb-4">Trade Score</h2>
          <div className="grid grid-cols-2 gap-3">
            {tradeStats.map((stat) => (
              <div
                key={stat.label}
                className="bg-[#1a1a26] rounded-xl p-4 border border-white/[0.06]"
              >
                <p className="text-2xl font-bold" style={{ color: stat.color }}>
                  {stat.value}
                </p>
                <p className="text-sm text-[#8888A0] mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Profile Details / Edit Form */}
        <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-6 animate-fade-in-up delay-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold font-display text-[#F0F0F5]">Profile Details</h2>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-1.5 text-sm font-medium text-[#D32F2F] border border-[#D32F2F] rounded-lg hover:bg-[#D32F2F]/10 transition"
              >
                Edit
              </button>
            )}
          </div>

          {serverError && (
            <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm mb-4">
              {serverError}
            </div>
          )}

          {isEditing ? (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Full Name */}
              <div>
                <label className={labelClasses}>Full Name</label>
                <input
                  type="text"
                  {...register('full_name')}
                  className={inputClasses}
                  placeholder="John Doe"
                />
                {errors.full_name && (
                  <p className="mt-1 text-sm text-red-400">{errors.full_name.message}</p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className={labelClasses}>Email</label>
                <input
                  type="email"
                  {...register('email')}
                  className={inputClasses}
                  placeholder="you@sfgov.org"
                />
                {errors.email && (
                  <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>
                )}
              </div>

              {/* Phone */}
              <div>
                <label className={labelClasses}>Phone</label>
                <input
                  type="tel"
                  {...register('phone')}
                  className={inputClasses}
                  placeholder="(415) 555-1234"
                />
              </div>

              {/* Rank */}
              <div>
                <label className={labelClasses}>Rank</label>
                <select {...register('rank')} className={selectClasses}>
                  {RANKS.map((rank) => (
                    <option key={rank} value={rank}>
                      {rank}
                    </option>
                  ))}
                </select>
              </div>

              {/* Position Type */}
              <div>
                <label className={labelClasses}>Position Type</label>
                <select {...register('position_type')} className={selectClasses}>
                  {POSITION_TYPES.map((pt) => (
                    <option key={pt} value={pt}>
                      {pt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tour */}
              <div>
                <label className={labelClasses}>Tour</label>
                <select {...register('tour')} className={selectClasses}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((t) => (
                    <option key={t} value={t}>
                      Tour {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Division */}
              <div>
                <label className={labelClasses}>Division</label>
                <select
                  value={watchDivision}
                  onChange={handleDivisionChange}
                  className={selectClasses}
                >
                  {DIVISIONS.map((d) => (
                    <option key={d} value={d}>
                      {getDivisionName(d)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Battalion */}
              <div>
                <label className={labelClasses}>Battalion</label>
                <select
                  value={watchBattalion}
                  onChange={handleBattalionChange}
                  className={selectClasses}
                >
                  {battalions.map((b) => (
                    <option key={b} value={b}>
                      {getBattalionLabel(b)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Station */}
              <div>
                <label className={labelClasses}>Station</label>
                <select {...register('station', { valueAsNumber: true })} className={selectClasses}>
                  {stations.map((s) => (
                    <option key={s} value={s}>
                      {getStationLabel(s)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 py-2.5 px-4 bg-[#1a1a26] border border-white/[0.06] text-[#8888A0] font-semibold rounded-lg hover:bg-[#222233] transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 px-4 bg-[#D32F2F] hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed text-[#F0F0F5] font-semibold rounded-lg transition"
                >
                  {saving ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Saving...
                    </span>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <DetailRow label="Division" value={getDivisionName(profile.division)} />
              <DetailRow label="Battalion" value={getBattalionLabel(profile.battalion)} />
              <DetailRow label="Station" value={getStationLabel(profile.station)} />
              <DetailRow label="Tour" value={`Tour ${profile.tour}`} />
              <DetailRow label="Position Type" value={profile.position_type} />
              <DetailRow label="Phone" value={profile.phone || 'Not set'} muted={!profile.phone} />
              <DetailRow label="Email" value={profile.email} />
            </div>
          )}
        </div>

        {/* Schedule */}
        <div className="bg-[#12121a] rounded-2xl border border-white/[0.06] p-6 animate-fade-in-up delay-3">
          <h2 className="text-lg font-semibold font-display text-[#F0F0F5] mb-2">Schedule</h2>
          <p className="text-sm text-[#8888A0] mb-4">
            If your schedule has changed, you can recalibrate it by re-entering your work days.
          </p>
          <button
            onClick={() => router.push('/schedule-setup')}
            className="w-full py-2.5 px-4 bg-[#4A9FFF] hover:bg-[#3a8fee] text-[#F0F0F5] font-semibold rounded-lg transition"
          >
            Recalibrate Schedule
          </button>
        </div>

        {/* Sign Out */}
        <button
          onClick={handleSignOut}
          className="w-full py-3 px-4 bg-[#12121a] border border-white/[0.06] text-red-400 font-semibold rounded-2xl hover:bg-[#222233] transition animate-fade-in-up delay-3"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-white/[0.06] last:border-b-0">
      <span className="text-sm text-[#8888A0]">{label}</span>
      <span className={`text-sm font-medium ${muted ? 'text-[#555570]' : 'text-[#F0F0F5]'}`}>
        {value}
      </span>
    </div>
  )
}
