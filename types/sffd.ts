import type { Timestamp } from 'firebase/firestore'

/**
 * User record stored in Firestore.  Each user belongs to a station,
 * battalion and division within the San Francisco Fire Department.
 */
export interface User {
  uid: string
  email: string | null
  name?: string
  rank: 'Firefighter' | 'EMT' | 'Medic' | 'Lieutenant' | 'Captain' | 'Chief'
  station: string
  battalion: string
  division: string
  phone?: string
  tradeStats: {
    covered: number
    given: number
    balance: number
  }
  fcmTokens?: string[]
  createdAt?: Timestamp
}

/**
 * Shift posted by a user.  Shifts are identified by a date and
 * shift type (24‑hour or PM).  Additional restrictions on who can
 * accept a shift are represented by the `acceptLimit` field.
 */
export interface Shift {
  id: string
  posterUid: string
  posterName: string
  date: string
  shiftType: '24-Hour' | 'PM'
  rank: string
  station: string
  battalion: string
  division: string
  returnDates: string[]
  acceptLimit: {
    type: 'station' | 'battalion' | 'division' | ''
    value: string
  }
  status: 'open' | 'covered' | 'cancelled'
  createdAt: Timestamp
}

/**
 * Trade record linking a taker to a posted shift.  Once a shift
 * has been accepted, a matched trade is created with a status
 * indicating whether it is confirmed, completed or cancelled.
 */
export interface MatchedTrade {
  id: string
  originalShiftId: string
  originalDate: string
  returnDate: string | null
  posterUid: string
  takerUid: string
  status: 'confirmed' | 'completed' | 'cancelled'
  createdAt: Timestamp
}