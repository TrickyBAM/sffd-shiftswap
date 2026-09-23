<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project rules

- **Read first:** `docs/ARCHITECTURE.md` is the binding design and build contract (its section 9 "Implementation notes" overrides earlier sections). `HANDOFF.md` covers the current state, services and common tasks. `docs/DEPLOY.md` covers deploys, env vars, the push webhook and rollback.
- **Dates** are `YYYY-MM-DD` strings in America/Los_Angeles. Use `src/lib/sffd/dates.ts`, and never `new Date('YYYY-MM-DD')`.
- **Data access** goes through `src/lib/api` (import from `@/lib/api`). It throws `AppError`, whose `message` is safe to show. Business rules live in the database RPCs. Schema changes are new files in `supabase/migrations/`. Never edit an applied migration.
- **Tests:** `npm run check` (lint + typecheck + all tests) must pass before you commit. Also run `npm run build` for anything that touches routes or config. Use `npm run test:unit` for fast unit tests and `npm run test:db` for the database tests (PGlite, no Docker). Add tests with every change to rules, routes or data code.
- **Never commit secrets.** No keys, passwords, connection strings or `.env*` files. Real values live in Vercel and in the local `.env.local` from `vercel env pull`. Don't log secrets, calendar tokens or full push endpoints.
- **Users are firefighters on phones.** Write plain-English copy, use 44 px tap targets, and give every data view loading, empty and error states (ARCHITECTURE section 7.2).
