'use client'

import { createContext, useContext } from 'react'
import { Profile } from '@/lib/types'

interface ProfileContextType {
  profile: Profile
  loading: boolean
}

const ProfileContext = createContext<ProfileContextType | null>(null)

export function ProfileProvider({
  children,
  profile,
}: {
  children: React.ReactNode
  profile: Profile
}) {
  return (
    <ProfileContext.Provider value={{ profile, loading: false }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextType {
  const ctx = useContext(ProfileContext)
  if (!ctx) {
    throw new Error('useProfile must be used within a ProfileProvider')
  }
  return ctx
}
