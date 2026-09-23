// src/lib/types/database.ts is hand-written. These checks read the migrations
// and the TypeScript source and fail when the two drift apart: table columns,
// check-constraint value sets, RPC hint codes and RPC argument names.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCEPT_LIMITS,
  ERROR_HINTS,
  MEMBER_STATUSES,
  NOTIFICATION_TYPES,
  NOTIFY_SCOPES,
  REQUEST_STATUSES,
  ROLES,
  SHIFT_STATUSES,
} from '@/lib/types/database'

const ROOT = path.resolve(__dirname, '../..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations')
const SQL = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n')
const TS = readFileSync(path.join(ROOT, 'src/lib/types/database.ts'), 'utf8')

/** The body of `create table public.<name> ( … );`. */
function tableSql(name: string): string {
  const m = new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`).exec(SQL)
  if (!m) throw new Error(`table ${name} not found in migrations`)
  return m[1]
}

/** Column names of a table (lines indented exactly two spaces, constraints skipped). */
function sqlColumns(name: string): string[] {
  return [...tableSql(name).matchAll(/^ {2}([a-z_][a-z0-9_]*) /gm)].map((m) => m[1]).filter((c) => c !== 'constraint')
}

/** Property names of `export interface <name> { … }` in database.ts. */
function tsKeys(name: string): string[] {
  const m = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(TS)
  if (!m) throw new Error(`interface ${name} not found in database.ts`)
  return [...m[1].matchAll(/^ {2}([a-z_][a-z0-9_]*)\??:/gm)].map((x) => x[1])
}

/** The quoted values of `<column> in ('a', 'b', …)` inside a table definition. */
function checkValues(table: string, column: string): string[] {
  const m = new RegExp(`${column} in \\(([^)]*)\\)`).exec(tableSql(table))
  if (!m) throw new Error(`check on ${table}.${column} not found`)
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
}

describe('table row types match the migrations', () => {
  it.each([
    ['stations', 'Station'],
    ['profiles', 'Profile'],
    ['roster', 'RosterEntry'],
    ['shifts', 'Shift'],
    ['shift_requests', 'ShiftRequest'],
    ['messages', 'Message'],
    ['notifications', 'Notification'],
    ['push_subscriptions', 'PushSubscription'],
    ['audit_log', 'AuditEntry'],
  ])('public.%s ↔ %s', (table, iface) => {
    expect(tsKeys(iface).sort()).toEqual(sqlColumns(table).sort())
  })
})

describe('value sets match the check constraints', () => {
  it.each([
    ['profiles', 'status', MEMBER_STATUSES],
    ['profiles', 'role', ROLES],
    ['profiles', 'notify_scope', NOTIFY_SCOPES],
    ['shifts', 'status', SHIFT_STATUSES],
    ['shifts', 'accept_limit', ACCEPT_LIMITS],
    ['shift_requests', 'status', REQUEST_STATUSES],
    ['notifications', 'type', NOTIFICATION_TYPES],
  ] as const)('%s.%s', (table, column, values) => {
    expect([...values].sort()).toEqual(checkValues(table, column).sort())
  })
})

describe('RPC hint codes', () => {
  it('ERROR_HINTS is exactly the set of hints the migrations raise', () => {
    const raised = new Set<string>()
    // private.fail('…', 'CODE') and private.problem('CODE', '…')
    for (const m of SQL.matchAll(/'([A-Z][A-Z_]{3,})'\s*\)/g)) raised.add(m[1])
    for (const m of SQL.matchAll(/private\.problem\('([A-Z_]+)'/g)) raised.add(m[1])
    expect([...raised].sort()).toEqual([...ERROR_HINTS].sort())
  })
})

describe('RPC catalogue matches the function signatures', () => {
  // `create or replace function public.<name>(<args>) returns`
  const sqlFunctions = new Map<string, string[]>()
  for (const m of SQL.matchAll(/create or replace function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/g)) {
    sqlFunctions.set(m[1], [...m[2].matchAll(/\b(p_\w+)\s/g)].map((x) => x[1]))
  }

  // `  <name>: { args: { … } … returns` entries of interface RpcFunctions.
  const block = /export interface RpcFunctions \{([\s\S]*?)\n\}/.exec(TS)?.[1] ?? ''
  const tsFunctions = new Map<string, string[]>()
  const entries = [...block.matchAll(/^ {2}(\w+): \{/gm)]
  entries.forEach((entry, i) => {
    const chunk = block.slice(entry.index, entries[i + 1]?.index ?? block.length)
    const args = chunk.slice(chunk.indexOf('args:'), chunk.indexOf('returns:'))
    tsFunctions.set(entry[1], [...args.matchAll(/\b(p_\w+)\??:/g)].map((x) => x[1]))
  })

  // Granted in 0010_privileges.sql but not RPCs the app calls through the API.
  const HELPERS = new Set(['today_pt', 'shift_starts_at', 'tour_works', 'name_key', 'is_approved', 'is_admin'])
  const granted = new Set(
    [...(SQL.match(/grant execute on function[\s\S]*?\bto\b/g) ?? []).join('\n').matchAll(/public\.(\w+)\(/g)].map((m) => m[1]),
  )

  it('every granted RPC is in RpcFunctions', () => {
    const expected = [...granted].filter((f) => !HELPERS.has(f)).sort()
    expect(expected.length).toBeGreaterThan(30)
    expect([...tsFunctions.keys()].sort()).toEqual(expected)
  })

  it.each([...tsFunctions.keys()])('%s has the SQL argument names', (fn) => {
    expect(sqlFunctions.has(fn)).toBe(true)
    expect(tsFunctions.get(fn)).toEqual(sqlFunctions.get(fn))
  })
})
