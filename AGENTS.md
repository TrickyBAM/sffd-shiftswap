# SFFD ShiftSwap Agent Notes

## Project
SFFD ShiftSwap is a shift-trading app for San Francisco Fire Department firefighters. It lets users sign up, log in, post shifts, view open shifts, accept trades, and manage profile/trade data with Firebase-backed real-time behavior.

## Stack
- Next.js 15.1 App Router, React 19, TypeScript, Tailwind CSS 4.1, and npm.
- Firebase Auth, Firestore, Firebase Cloud Functions, Firebase Messaging, and Firebase Hosting.
- Capacitor 6 for planned iOS/Android shells.
- Vitest, Playwright, Prettier, ESLint, and a GitHub Actions Firebase deploy workflow.

## Gotchas And Quirks
- `next.config.ts` opts into experimental `authInterrupts`; check current Next behavior before touching auth/forbidden/unauthorized flows.
- Firebase config comes from `NEXT_PUBLIC_FIREBASE_*` env vars. Never hard-code Firebase credentials outside env files.
- `firebase.json` points hosting at `public`, while the README/Capacitor notes mention generated web output. Verify the actual deployment target before changing build/deploy scripts.
- The README contains some citation-style artifacts in text. Clean them only as part of a docs cleanup, not mixed into feature work.
- Firestore rules and role/hierarchy logic matter for department data. Review `firestore.rules`, `lib/hierarchy.ts`, and `types/sffd.ts` before changing permissions or shift workflows.

## How Brian Works
- Brian describes what he wants in plain English. Do the actual implementation, testing, and GitHub work for him.
- Do not hand Brian snippets to paste or ask him to read code. Make the change, verify it, and summarize in plain English.
- Read the README, recent commits, `AGENTS.md`, and `CLAUDE.md` before assuming project context.
- Ask only for real product direction, source-of-truth choices, or destructive/live-production actions. For normal branch work, proceed.
- Prefer the existing stack and npm. Do not add new frameworks or major libraries without a clear reason.
