// Shared helpers for the database scripts in scripts/db/ (ESM, no build step).
//
// Environment: real environment variables win, then .env.local, then .env
// (a tiny KEY=value parser — no dotenv dependency). `vercel env pull
// .env.local` provides the Supabase integration's POSTGRES_URL_NON_POOLING.
//
// Nothing here ever prints a connection string, password or config value.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Parses dotenv-style text: `KEY=value`, optional `export `, `#` comments,
 * single/double quotes (double quotes understand \n, \r, \t, \" and \\),
 * and ` #` inline comments after unquoted values.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, rest] = match
    let value = rest
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote))
      if (quote === '"') {
        value = value.replace(/\\([nrt"\\])/g, (_, ch) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[ch])
      }
    } else {
      const hash = value.search(/\s#/)
      if (hash >= 0) value = value.slice(0, hash)
      value = value.trim()
    }
    out[key] = value
  }
  return out
}

/**
 * Loads .env.local and .env from the repo root into process.env without
 * overriding variables that are already set.
 * @param {string} [root]
 */
export function loadEnv(root = ROOT) {
  for (const file of ['.env.local', '.env']) {
    const full = path.join(root, file)
    if (!existsSync(full)) continue
    const vars = parseEnv(readFileSync(full, 'utf8'))
    for (const [key, value] of Object.entries(vars)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

/**
 * The direct (non-pooled) connection string for migrations and admin scripts.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string, source: string } | null}
 */
export function connectionString(env = process.env) {
  for (const name of ['POSTGRES_URL_NON_POOLING', 'DATABASE_URL', 'POSTGRES_URL']) {
    const value = env[name]?.trim()
    if (value) return { url: value, source: name }
  }
  return null
}

/**
 * Host name of a connection string, parsed loosely so odd characters in the
 * password can't break it.
 * @param {string} url
 */
export function hostOf(url) {
  const afterScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const afterAuth = afterScheme.slice(afterScheme.lastIndexOf('@') + 1)
  if (afterAuth.startsWith('[')) return afterAuth.slice(0, afterAuth.indexOf(']') + 1)
  return afterAuth.split(/[:/?#]/)[0]
}

/**
 * "host:port/database" — safe to print (no user name or password).
 * @param {string} url
 */
export function describeTarget(url) {
  const afterScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const afterAuth = afterScheme.slice(afterScheme.lastIndexOf('@') + 1)
  const hostPort = afterAuth.split(/[/?#]/)[0]
  const database = (afterAuth.split('/')[1] ?? '').split(/[?#]/)[0] || 'postgres'
  return `${hostPort}/${database}`
}

/** @param {string} host */
export function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase())
}

/**
 * Removes libpq SSL parameters from the query string. node-postgres lets them
 * override the `ssl` option (and treats sslmode=require as verify-full), which
 * would reject Supabase's certificate chain.
 * @param {string} url
 */
export function stripSslParams(url) {
  const q = url.indexOf('?')
  if (q === -1) return url
  const kept = url
    .slice(q + 1)
    .split('&')
    .filter((part) => part && !/^(sslmode|sslcert|sslkey|sslrootcert|sslaccept|uselibpqcompat)=/i.test(part))
  return kept.length ? `${url.slice(0, q)}?${kept.join('&')}` : url.slice(0, q)
}

/**
 * node-postgres client config: TLS without certificate verification for remote
 * hosts (Supabase), plain TCP for localhost.
 * @param {string} url
 * @returns {import('pg').ClientConfig}
 */
export function clientConfig(url) {
  return {
    connectionString: stripSslParams(url),
    ssl: isLocalHost(hostOf(url)) ? false : { rejectUnauthorized: false },
    application_name: 'sffd-shiftswap-scripts',
  }
}

/**
 * Loads the environment and opens a connection. Exits with a friendly message
 * when no connection string is configured.
 * @returns {Promise<{ client: import('pg').Client, target: string, source: string }>}
 */
export async function connect() {
  loadEnv()
  const found = connectionString()
  if (!found) {
    console.error(
      'No database connection string found. Set POSTGRES_URL_NON_POOLING (or DATABASE_URL / POSTGRES_URL),\n' +
        'e.g. run `vercel env pull .env.local` in the project folder.',
    )
    process.exit(1)
  }
  if (describeTarget(found.url).split('/')[0].endsWith(':6543')) {
    console.warn(`Warning: ${found.source} points at the transaction pooler (port 6543); prefer POSTGRES_URL_NON_POOLING.`)
  }
  const client = new pg.Client(clientConfig(found.url))
  try {
    await client.connect()
  } catch (error) {
    console.error(`Could not connect to ${describeTarget(found.url)}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  return { client, target: describeTarget(found.url), source: found.source }
}

/**
 * Prints a database error without anything sensitive.
 * @param {string} prefix
 * @param {unknown} error
 */
export function printDbError(prefix, error) {
  const e = /** @type {{ message?: string, hint?: string, detail?: string, where?: string, position?: string }} */ (error)
  console.error(`${prefix}: ${e?.message ?? String(error)}`)
  if (e?.detail) console.error(`  detail: ${e.detail}`)
  if (e?.hint) console.error(`  hint: ${e.hint}`)
  if (e?.where) console.error(`  where: ${e.where}`)
  if (e?.position) console.error(`  position: ${e.position}`)
}
