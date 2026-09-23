#!/usr/bin/env node
// Upserts settings in private.app_config (read by database code, e.g. the push
// webhook trigger in 0009_public_push_realtime.sql).
//
//   node scripts/db/set-app-config.mjs push_webhook_url=https://<app>/api/push/flush
//   node scripts/db/set-app-config.mjs push_webhook_secret=@env:PUSH_WEBHOOK_SECRET
//   node scripts/db/set-app-config.mjs --unset push_webhook_url push_webhook_secret
//   node scripts/db/set-app-config.mjs --list
//
// A value of `@env:NAME` is read from the environment (or .env.local / .env),
// which keeps secrets out of shell history. Values are never printed, except
// for keys ending in _url.

import { connect, loadEnv, printDbError } from './_env.mjs'

const USAGE = [
  'Usage: node scripts/db/set-app-config.mjs key=value [key=value ...]',
  '       node scripts/db/set-app-config.mjs --unset key [key ...]',
  '       node scripts/db/set-app-config.mjs --list',
  'A value of @env:NAME reads environment variable NAME.',
].join('\n')

const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/

/** Shown in full only for URLs; everything else is masked. */
function display(key, value) {
  return key.endsWith('_url') ? value : `<hidden, ${value.length} chars>`
}

function fail(message) {
  console.error(`${message}\n${USAGE}`)
  process.exit(2)
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE)
    process.exit(argv.length === 0 ? 2 : 0)
  }
  if (argv[0] === '--list') {
    if (argv.length > 1) fail('--list takes no arguments.')
    return { mode: 'list' }
  }
  if (argv[0] === '--unset') {
    const keys = argv.slice(1)
    if (keys.length === 0) fail('Name at least one key to unset.')
    for (const key of keys) if (!KEY_RE.test(key)) fail(`Invalid key "${key}".`)
    return { mode: 'unset', keys }
  }
  loadEnv()
  const pairs = []
  for (const arg of argv) {
    const eq = arg.indexOf('=')
    if (eq <= 0) fail(`Expected key=value, got "${arg}".`)
    const key = arg.slice(0, eq)
    let value = arg.slice(eq + 1)
    if (!KEY_RE.test(key)) fail(`Invalid key "${key}" (lowercase letters, digits and _).`)
    if (value.startsWith('@env:')) {
      const name = value.slice(5)
      const fromEnv = process.env[name]
      if (!fromEnv) fail(`Environment variable ${name} is not set.`)
      value = fromEnv
    }
    if (value.trim() === '') fail(`Empty value for "${key}" — use --unset to remove a key.`)
    pairs.push({ key, value })
  }
  return { mode: 'set', pairs }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { client, target } = await connect()
  console.log(`Database: ${target}`)
  try {
    if (opts.mode === 'list') {
      const { rows } = await client.query('select key, value from private.app_config order by key')
      if (rows.length === 0) console.log('(no settings)')
      for (const row of rows) console.log(`${row.key} = ${display(row.key, row.value)}`)
      return
    }

    await client.query('begin')
    if (opts.mode === 'unset') {
      for (const key of opts.keys) {
        const res = await client.query('delete from private.app_config where key = $1', [key])
        console.log(res.rowCount ? `unset ${key}` : `${key} was not set`)
      }
    } else {
      for (const { key, value } of opts.pairs) {
        await client.query(
          `insert into private.app_config (key, value) values ($1, $2)
           on conflict (key) do update set value = excluded.value`,
          [key, value],
        )
        console.log(`set ${key} = ${display(key, value)}`)
      }
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    printDbError('set-app-config failed', error)
    process.exitCode = 1
  } finally {
    await client.end().catch(() => undefined)
  }
}

main().catch((error) => {
  printDbError('set-app-config failed', error)
  process.exit(1)
})
