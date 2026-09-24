// Loads individual pure SQL functions (e.g. public.tour_works, public.name_key)
// from supabase/migrations into an in-memory PGlite so unit tests can check the
// SQL and TypeScript implementations against the same fixtures without booting
// the full schema. Later migrations win if a function is redefined.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations')

/** The last `create or replace function <name>(…) … $$ … $$;` statement in the migrations, or null. */
export function extractSqlFunction(qualifiedName: string): string | null {
  if (!existsSync(MIGRATIONS_DIR)) return null
  const escaped = qualifiedName.replace(/\./g, '\\.')
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$\\s*;`, 'gi')
  let found: string | null = null
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    for (const match of sql.matchAll(re)) found = match[0]
  }
  return found
}

/** Boots PGlite and creates the given function definitions. */
export async function pgWithFunctions(definitions: string[]): Promise<PGlite> {
  const pg = new PGlite()
  await pg.waitReady
  for (const sql of definitions) await pg.exec(sql)
  return pg
}
