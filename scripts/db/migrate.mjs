#!/usr/bin/env node
// Applies supabase/migrations/NNNN_*.sql to the database in filename order
// (ARCHITECTURE §6). Each pending file runs in its own transaction and is
// recorded in private.schema_migrations, so re-running only applies new files.
//
//   npm run db:migrate                 apply pending migrations
//   npm run db:migrate -- --dry-run    list pending migrations, change nothing
//   npm run db:migrate -- --status     list applied and pending migrations
//
// Connection: POSTGRES_URL_NON_POOLING, else DATABASE_URL, else POSTGRES_URL
// (environment first, then .env.local / .env). Never prints secrets.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, connect, printDbError } from './_env.mjs'

const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')
const LOCK_KEY = 'sffd-shiftswap:migrations'
const USAGE = 'Usage: node scripts/db/migrate.mjs [--dry-run | --status]'

/** Migration files in apply order. */
function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => /^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(name))
    .sort()
}

function parseArgs(argv) {
  const flags = new Set(argv)
  for (const flag of flags) {
    if (!['--dry-run', '--status', '--help', '-h'].includes(flag)) {
      console.error(`Unknown option ${flag}\n${USAGE}`)
      process.exit(2)
    }
  }
  if (flags.has('--help') || flags.has('-h')) {
    console.log(USAGE)
    process.exit(0)
  }
  if (flags.has('--dry-run') && flags.has('--status')) {
    console.error(`Choose one of --dry-run or --status.\n${USAGE}`)
    process.exit(2)
  }
  return { dryRun: flags.has('--dry-run'), status: flags.has('--status') }
}

async function appliedMigrations(client) {
  const exists = await client.query(`select to_regclass('private.schema_migrations') is not null as ok`)
  if (!exists.rows[0].ok) return new Map()
  const { rows } = await client.query(`select filename, applied_at from private.schema_migrations order by filename`)
  return new Map(rows.map((r) => [r.filename, r.applied_at]))
}

async function main() {
  const { dryRun, status } = parseArgs(process.argv.slice(2))
  const files = migrationFiles()
  const { client, target, source } = await connect()
  console.log(`Database: ${target} (from ${source})`)

  let locked = false
  try {
    // One migrator at a time.
    await client.query('select pg_advisory_lock(hashtext($1))', [LOCK_KEY])
    locked = true

    const applied = await appliedMigrations(client)
    const pending = files.filter((f) => !applied.has(f))
    const unknown = [...applied.keys()].filter((f) => !files.includes(f))
    for (const f of unknown) console.warn(`Warning: ${f} is recorded as applied but is not in supabase/migrations.`)

    if (status) {
      for (const f of files) {
        const at = applied.get(f)
        console.log(`${at ? 'applied' : 'pending'}  ${f}${at ? `  (${new Date(at).toISOString()})` : ''}`)
      }
      console.log(`${files.length - pending.length} applied, ${pending.length} pending.`)
      return
    }

    if (pending.length === 0) {
      console.log('Database is up to date.')
      return
    }

    if (dryRun) {
      console.log(`${pending.length} pending migration(s):`)
      for (const f of pending) console.log(`  ${f}`)
      return
    }

    await client.query(`create schema if not exists private`)
    await client.query(
      `create table if not exists private.schema_migrations (
         filename text primary key,
         applied_at timestamptz not null default now()
       )`,
    )

    for (const file of pending) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      const started = Date.now()
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into private.schema_migrations (filename) values ($1)', [file])
        await client.query('commit')
        console.log(`applied  ${file}  (${Date.now() - started} ms)`)
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        printDbError(`FAILED   ${file} (rolled back; later migrations not applied)`, error)
        process.exitCode = 1
        return
      }
    }
    console.log(`Done: ${pending.length} migration(s) applied.`)
  } finally {
    if (locked) await client.query('select pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

main().catch((error) => {
  printDbError('Migration failed', error)
  process.exit(1)
})
