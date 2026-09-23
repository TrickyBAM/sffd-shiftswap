// Typed data layer (ARCHITECTURE §7.3): one function per RPC and per common
// read. Every function takes a Supabase client first — the browser client
// (src/lib/supabase/client.ts), the per-request server client
// (src/lib/supabase/server.ts) or, where noted, the service-role client — and
// either returns typed data or throws an AppError (src/lib/errors.ts) whose
// `message` is safe to show and whose `code` is an RPC hint, 'NETWORK' or
// 'UNKNOWN'.
//
// Mutations that notify someone also ask /api/push/flush to deliver the alerts
// (browser only, coalesced, fire-and-forget), so pages don't need to.

export { callRpc, isUuid, resolveUserId, type CountedPage, type Page, type Sb } from './core'
export * from './admin'
export * from './messages'
export * from './notifications'
export * from './profile'
export * from './public'
export * from './push'
export * from './requests'
export * from './roster'
export * from './schedule'
export * from './shifts'
export * from './trades'
