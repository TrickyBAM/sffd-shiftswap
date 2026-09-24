#!/usr/bin/env node
// Makes an existing member an approved admin — the bootstrap for the very first
// admin (after that, admins use Admin ▸ Members in the app).
//
//   node scripts/db/make-admin.mjs someone@example.com
//
// Sets role = 'admin', status = 'approved', approved_at = now() on the profile
// with that email (case-insensitive). telestaff_ack_at is left as it is, so the
// member still sees the TeleStaff notice once. Sign up (and ideally finish the
// profile form) in the app first. Uses the same connection settings as
// migrate.mjs and records the change in the audit log.

import { connect, printDbError } from './_env.mjs'

const USAGE = 'Usage: node scripts/db/make-admin.mjs <email>'

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  const email = (args[0] ?? '').trim()
  if (args.length !== 1 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    console.error(USAGE)
    process.exit(2)
  }

  const { client, target } = await connect()
  console.log(`Database: ${target}`)
  try {
    await client.query('begin')
    const { rows } = await client.query(
      `update public.profiles
          set role = 'admin', status = 'approved', status_reason = null, approved_at = now()
        where lower(email) = lower($1)
       returning id, email, full_name, rank, station, telestaff_ack_at`,
      [email],
    )
    if (rows.length === 0) {
      await client.query('rollback')
      console.error(`No member with email ${email}. Sign up in the app first, then run this again.`)
      process.exitCode = 1
      return
    }
    for (const row of rows) {
      await client.query(
        `insert into public.audit_log (actor_id, action, target_type, target_id, details)
         values (null, 'admin.granted_by_script', 'profile', $1, jsonb_build_object('email', $2::text))`,
        [row.id, row.email],
      )
    }
    await client.query('commit')

    for (const row of rows) {
      console.log(`${row.full_name || '(no name yet)'} <${row.email}> is now an approved admin.`)
      if (!row.rank || row.station == null) {
        console.warn('  Note: this profile has no rank/station yet. Complete it under Admin ▸ Members (or Profile) before trading.')
      }
      if (!row.telestaff_ack_at) console.log('  They will see the TeleStaff notice at next sign-in.')
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    printDbError('make-admin failed', error)
    process.exitCode = 1
  } finally {
    await client.end().catch(() => undefined)
  }
}

main().catch((error) => {
  printDbError('make-admin failed', error)
  process.exit(1)
})
