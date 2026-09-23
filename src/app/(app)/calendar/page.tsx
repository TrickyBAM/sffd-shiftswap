import type { Metadata } from 'next'
import { CalendarView } from './_components/CalendarView'

export const metadata: Metadata = {
  title: 'Calendar',
}

interface CalendarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Home (ARCHITECTURE §7.1): my month, what's coming up and my balance. ?month=YYYY-MM opens a month. */
export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const { month } = await searchParams
  return <CalendarView initialMonth={typeof month === 'string' ? month : null} />
}
