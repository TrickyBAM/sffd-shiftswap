import { redirect } from 'next/navigation'

// "/" is never a page of its own (ARCHITECTURE §7.1): the calendar is home.
// Signed-out visitors are sent to /login by the proxy, and the (app) layout
// gates anyone who hasn't finished onboarding.
export default function Home() {
  redirect('/calendar')
}
