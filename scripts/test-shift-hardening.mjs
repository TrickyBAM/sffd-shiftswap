import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(rootDir, 'src/lib/shift-acceptance.ts')
const tempDir = path.join(rootDir, '.tmp-test')
const compiledPath = path.join(tempDir, 'shift-acceptance.mjs')

const source = await readFile(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

await mkdir(tempDir, { recursive: true })
await writeFile(compiledPath, compiled)

const {
  getAcceptanceErrorMessage,
  shouldUseLegacyAccept,
} = await import(`${pathToFileURL(compiledPath).href}?cacheBust=${Date.now()}`)

const phaseOne = await readFile(
  path.join(rootDir, 'supabase/migrations/202607100001_add_atomic_swapmatch_rpc.sql'),
  'utf8'
)
const phaseTwo = await readFile(
  path.join(rootDir, 'supabase/migrations/202607100002_tighten_direct_write_policies.sql'),
  'utf8'
)
const shiftBoard = await readFile(
  path.join(rootDir, 'src/app/(app)/shift-board/page.tsx'),
  'utf8'
)
const keepaliveRoute = await readFile(
  path.join(rootDir, 'src/app/api/keepalive/route.ts'),
  'utf8'
)

test('legacy acceptance is used only when the atomic RPC itself is missing', () => {
  assert.equal(shouldUseLegacyAccept({
    code: 'PGRST202',
    message: 'Could not find public.accept_shift_with_match in the schema cache',
  }), true)
  assert.equal(shouldUseLegacyAccept({
    code: '42883',
    message: 'function public.accept_shift_with_match does not exist',
  }), true)
  assert.equal(shouldUseLegacyAccept({
    code: '42501',
    message: 'permission denied for function accept_shift_with_match',
  }), false)
  assert.equal(shouldUseLegacyAccept({
    code: 'PGRST202',
    message: 'Could not find a different function',
  }), false)
})

test('Supabase error messages survive object-shaped thrown errors', () => {
  assert.equal(
    getAcceptanceErrorMessage({ message: 'This shift was already accepted' }),
    'This shift was already accepted'
  )
  assert.equal(getAcceptanceErrorMessage(null), 'Failed to accept shift')
})

test('phase one validates and locks before the existing accept RPC, then records both rows', () => {
  const lockAt = phaseOne.indexOf('for update;')
  const dateCheckAt = phaseOne.indexOf("p_return_date = any(v_shift.return_dates)")
  const acceptAt = phaseOne.indexOf('perform public.accept_shift(p_shift_id);')
  const matchAt = phaseOne.indexOf('insert into public.matched_trades')
  const notificationAt = phaseOne.indexOf('insert into public.notifications')

  assert.ok(lockAt > -1)
  assert.ok(dateCheckAt > lockAt)
  assert.ok(acceptAt > dateCheckAt)
  assert.ok(matchAt > acceptAt)
  assert.ok(notificationAt > matchAt)
  assert.match(phaseOne, /grant execute on function public\.accept_shift_with_match\(uuid, date\) to authenticated/)
  assert.match(phaseOne, /using \(auth\.uid\(\) = id\)/)
})

test('phase two replaces broad writes with shift-bound compatibility policies', () => {
  assert.doesNotMatch(phaseTwo, /with check \(\(auth\.uid\(\) is not null\)\)/i)
  assert.match(phaseTwo, /accepted_shift\.coverer_id = auth\.uid\(\)/)
  assert.match(phaseTwo, /return_date = any\(accepted_shift\.return_dates\)/)
  assert.match(phaseTwo, /accepted_match\.poster_id = user_id/)
  assert.match(phaseTwo, /to authenticated\s+using \(true\)/)
})

test('web build is compatible on both sides of phase one', () => {
  assert.match(shiftBoard, /rpc\(ATOMIC_ACCEPT_RPC/)
  assert.match(shiftBoard, /shouldUseLegacyAccept/)
  assert.match(shiftBoard, /rpc\('accept_shift'/)
  assert.match(keepaliveRoute, /rpc\/app_keepalive/)
  assert.match(keepaliveRoute, /rest\/v1\/shifts/)
})
