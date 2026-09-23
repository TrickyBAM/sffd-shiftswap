import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'SFFD ShiftSwap',
    short_name: 'ShiftSwap',
    description: 'Trade shifts with other SFFD members. Unofficial — TeleStaff remains the official record.',
    start_url: '/calendar',
    scope: '/',
    display: 'standalone',
    // No orientation lock: some members use tablets in landscape (WCAG 1.3.4).
    background_color: '#0a0a0f',
    theme_color: '#0a0a0f',
    categories: ['productivity', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Post a shift',
        short_name: 'Post',
        url: '/post',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Shift board',
        short_name: 'Board',
        url: '/board',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  }
}
