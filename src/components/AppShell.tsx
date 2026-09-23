import type { ReactNode } from 'react'
import Navigation from './Navigation'

/**
 * Signed-in app frame: navigation (bottom bar / left rail) plus the <main> landmark,
 * padded to clear the tab bar, the rail and the iOS safe areas. The root layout's
 * "Skip to content" link targets #main.
 *
 *   <ProfileProvider profile={profile}>
 *     <AppShell>{children}</AppShell>
 *   </ProfileProvider>
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Navigation />
      <main
        id="main"
        tabIndex={-1}
        className="min-h-dvh pb-nav outline-none md:pb-8 md:pl-[var(--rail-width)]"
      >
        {children}
      </main>
    </>
  )
}
