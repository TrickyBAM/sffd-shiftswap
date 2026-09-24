import type { ReactNode } from 'react'
import Navigation from './Navigation'

/**
 * Signed-in app frame: navigation (bottom bar / left rail) plus the <main> landmark,
 * padded to clear the tab bar, the rail and the iOS safe areas (left and right too, for
 * phones in landscape). The root layout's "Skip to content" link targets #main.
 *
 * The rail is used only on desktop layouts (see Navigation): at least 1024 px wide, or
 * 768 px with a mouse/trackpad. A phone turned sideways (844–932 px, touch) keeps the
 * bottom tab bar.
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
        className="min-h-dvh pb-nav px-safe outline-none [@media(min-width:1024px),(min-width:768px)_and_(pointer:fine)]:pb-8 [@media(min-width:1024px),(min-width:768px)_and_(pointer:fine)]:pl-[var(--rail-width)]"
      >
        {children}
      </main>
    </>
  )
}
