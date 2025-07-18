import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'

/**
 * Client‑side Firebase initialization.
 *
 * To configure Firebase for your environment, define the following
 * environment variables in a `.env.local` file at the root of the
 * repository:
 *
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
 *   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *
 * These variables are injected at build time by Next.js.  See
 * https://firebase.google.com/docs/web/setup for details on
 * obtaining these values.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

// Firebase services used in the app.  Separating these exports
// simplifies tree‑shaking and avoids loading unused services.
export const auth = getAuth(app)
export const db = getFirestore(app)
// Messaging is optional and only loaded on supported platforms.
export const messagingPromise = isSupported()
  .then((supported) => (supported ? getMessaging(app) : null))
  .catch(() => null)

export default app