// scripts/db helpers: env parsing, connection-string handling (never leaking
// secrets) and argument checking. Nothing here connects to a database.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clientConfig,
  connectionString,
  describeTarget,
  hostOf,
  isLocalHost,
  loadEnv,
  parseEnv,
  stripSslParams,
} from '../../scripts/db/_env.mjs'
import { migrationFiles } from './harness'

const ROOT = path.resolve(__dirname, '..', '..')
const SUPABASE_URL =
  'postgres://postgres.abcdefgh:S3cr3t%23pw@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=require&supa=base-pooler.x'

describe('parseEnv', () => {
  it('reads KEY=value lines with quotes, export and comments', () => {
    const env = parseEnv(
      [
        '# comment',
        'PLAIN=value',
        'export EXPORTED=yes',
        'SPACED = trimmed  # trailing comment',
        'DOUBLE="has spaces # not a comment"',
        "SINGLE='raw \\n stays'",
        'ESCAPED="line1\\nline2"',
        'EMPTY=',
        'URL=postgres://u:p@h:5432/db?sslmode=require',
        'not a line',
      ].join('\r\n'),
    )
    expect(env).toEqual({
      PLAIN: 'value',
      EXPORTED: 'yes',
      SPACED: 'trimmed',
      DOUBLE: 'has spaces # not a comment',
      SINGLE: 'raw \\n stays',
      ESCAPED: 'line1\nline2',
      EMPTY: '',
      URL: 'postgres://u:p@h:5432/db?sslmode=require',
    })
  })
})

describe('loadEnv', () => {
  const saved = { ...process.env }
  let dir = ''
  afterEach(() => {
    for (const key of ['SFFD_TEST_A', 'SFFD_TEST_B', 'SFFD_TEST_C']) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('prefers the real environment, then .env.local, then .env', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sffd-env-'))
    writeFileSync(path.join(dir, '.env.local'), 'SFFD_TEST_A=local\nSFFD_TEST_B=local\n')
    writeFileSync(path.join(dir, '.env'), 'SFFD_TEST_B=env\nSFFD_TEST_C=env\n')
    process.env.SFFD_TEST_A = 'real'
    delete process.env.SFFD_TEST_B
    delete process.env.SFFD_TEST_C
    loadEnv(dir)
    expect([process.env.SFFD_TEST_A, process.env.SFFD_TEST_B, process.env.SFFD_TEST_C]).toEqual(['real', 'local', 'env'])
  })
})

describe('connection strings', () => {
  it('prefers POSTGRES_URL_NON_POOLING, then DATABASE_URL, then POSTGRES_URL', () => {
    expect(connectionString({ POSTGRES_URL: 'c', DATABASE_URL: 'b', POSTGRES_URL_NON_POOLING: 'a' })).toEqual({
      url: 'a',
      source: 'POSTGRES_URL_NON_POOLING',
    })
    expect(connectionString({ POSTGRES_URL: 'c', DATABASE_URL: 'b' })?.source).toBe('DATABASE_URL')
    expect(connectionString({ POSTGRES_URL: 'c', POSTGRES_URL_NON_POOLING: '  ' })?.source).toBe('POSTGRES_URL')
    expect(connectionString({})).toBeNull()
  })

  it('describes the target without user name or password', () => {
    const shown = describeTarget(SUPABASE_URL)
    expect(shown).toBe('aws-0-us-west-1.pooler.supabase.com:5432/postgres')
    expect(shown).not.toContain('S3cr3t')
    expect(shown).not.toContain('abcdefgh')
    expect(describeTarget('postgresql://u:p@w0rd@localhost/app')).toBe('localhost/app')
  })

  it('uses TLS without certificate checks for remote hosts and drops libpq ssl params', () => {
    const config = clientConfig(SUPABASE_URL)
    expect(config.ssl).toEqual({ rejectUnauthorized: false })
    expect(config.connectionString).not.toContain('sslmode')
    expect(config.connectionString).toContain('supa=base-pooler.x')
    expect(clientConfig('postgres://postgres:pw@localhost:54322/postgres?sslmode=disable').ssl).toBe(false)
    expect(clientConfig('postgres://postgres:pw@127.0.0.1:5432/postgres').ssl).toBe(false)
  })

  it('parses hosts loosely', () => {
    expect(hostOf(SUPABASE_URL)).toBe('aws-0-us-west-1.pooler.supabase.com')
    expect(hostOf('postgres://[::1]:5432/db')).toBe('[::1]')
    expect(isLocalHost('LOCALHOST')).toBe(true)
    expect(isLocalHost('db.example.com')).toBe(false)
    expect(stripSslParams('postgres://h/db?sslmode=require')).toBe('postgres://h/db')
    expect(stripSslParams('postgres://h/db')).toBe('postgres://h/db')
  })
})

describe('script arguments (checked before connecting)', () => {
  const run = (script: string, args: string[]) =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'db', script), ...args], { encoding: 'utf8', timeout: 20_000 })

  it('migrate.mjs --help / unknown flags', () => {
    expect(run('migrate.mjs', ['--help'])).toMatchObject({ status: 0 })
    const bad = run('migrate.mjs', ['--force'])
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('Unknown option --force')
    expect(run('migrate.mjs', ['--dry-run', '--status']).status).toBe(2)
  })

  it('make-admin.mjs requires exactly one email', () => {
    expect(run('make-admin.mjs', []).status).toBe(2)
    expect(run('make-admin.mjs', ['not-an-email']).status).toBe(2)
    expect(run('make-admin.mjs', ['--help']).status).toBe(0)
  })

  it('set-app-config.mjs validates keys and values', () => {
    expect(run('set-app-config.mjs', []).status).toBe(2)
    expect(run('set-app-config.mjs', ['novalue']).status).toBe(2)
    expect(run('set-app-config.mjs', ['Bad-Key=x']).status).toBe(2)
    expect(run('set-app-config.mjs', ['push_webhook_url=']).status).toBe(2)
    expect(run('set-app-config.mjs', ['push_webhook_secret=@env:SFFD_DEFINITELY_UNSET_VAR']).status).toBe(2)
    expect(run('set-app-config.mjs', ['--unset']).status).toBe(2)
  })
})

describe('migration files', () => {
  it('are numbered 0001… without gaps, so filename order is apply order', () => {
    const files = migrationFiles()
    expect(files.length).toBeGreaterThanOrEqual(10)
    files.forEach((file, i) => expect(file.slice(0, 4)).toBe(String(i + 1).padStart(4, '0')))
  })
})
