export type Rank = 'Firefighter' | 'Paramedic' | 'Lieutenant' | 'Captain' | 'Battalion Chief'
export type PositionType = 'Firefighter' | 'Paramedic' | 'Officer'
export type ShiftType = '24-Hour' | '12-Hour Day' | '12-Hour Night'
export type ShiftStatus = 'open' | 'covered' | 'cancelled'
export type AcceptLimitType = '' | 'station' | 'battalion' | 'division'
export type NotificationType = 'shift_accepted' | 'shift_posted' | 'shift_filled' | 'swap_confirmed'

export interface Profile {
  id: string
  full_name: string
  email: string
  rank: Rank
  position_type: PositionType
  tour: number
  division: number
  battalion: number
  station: number
  phone?: string
  trade_requested: number
  trade_filled: number
  trade_outstanding: number
  trade_earned: number
  profile_complete: boolean
  created_at: string
  updated_at: string
}

export interface Shift {
  id: string
  poster_id: string
  poster_name: string
  division: number
  battalion: number
  station: number
  rank: Rank
  date: string
  shift_type: ShiftType
  status: ShiftStatus
  return_dates: string[]
  accept_limit_type: AcceptLimitType
  coverer_id?: string
  coverer_name?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface MatchedTrade {
  id: string
  original_shift_id: string
  original_date: string
  return_date: string
  poster_id: string
  taker_id: string
  poster_name: string
  taker_name: string
  status: 'confirmed' | 'completed'
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  message: string
  shift_id?: string
  related_user_id?: string
  read: boolean
  created_at: string
}

export interface SFDDivision {
  id: number
  name: string
  battalions: SFFDBattalion[]
}

export interface SFFDBattalion {
  id: number
  stations: number[]
}
