import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { addDays, format, parse } from 'date-fns'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(rootDir, 'src/lib/schedule.ts')
const tempDir = path.join(rootDir, '.tmp-test')
const compiledPath = path.join(tempDir, 'schedule.mjs')

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
  detectSchedulePattern,
  getPredictionMonth,
  getWorkDatesForMonth,
  refinePattern,
} = await import(`${pathToFileURL(compiledPath).href}?cacheBust=${Date.now()}`)

function parseDate(date) {
  return parse(date, 'yyyy-MM-dd', new Date())
}

function makeDates(anchorDate, gaps, count) {
  let current = parseDate(anchorDate)
  const dates = [current]

  for (let i = 0; i < count - 1; i++) {
    current = addDays(current, gaps[i % gaps.length])
    dates.push(current)
  }

  return dates
}

const sffdLikePattern = [2, 4, 1, 4, 2, 4]
const aprilDates = [
  '2026-04-01',
  '2026-04-03',
  '2026-04-07',
  '2026-04-08',
  '2026-04-12',
  '2026-04-14',
  '2026-04-18',
  '2026-04-20',
  '2026-04-24',
  '2026-04-25',
  '2026-04-29',
]
const mayDates = [
  '2026-05-01',
  '2026-05-05',
  '2026-05-07',
  '2026-05-11',
  '2026-05-12',
  '2026-05-16',
  '2026-05-18',
  '2026-05-22',
  '2026-05-24',
  '2026-05-28',
  '2026-05-29',
]

test('detectSchedulePattern recovers a repeating non-uniform gap pattern', () => {
  const result = detectSchedulePattern(makeDates('2026-04-01', sffdLikePattern, 18))

  assert.deepEqual(result.gapPattern, sffdLikePattern)
  assert.equal(result.anchorDate, '2026-04-01')
  assert.equal(result.confidence, 1)
})

test('getWorkDatesForMonth projects work dates into a requested month', () => {
  const dates = getWorkDatesForMonth('2026-04-01', sffdLikePattern, 2026, 5)

  assert.deepEqual(dates, mayDates)
})

test('refinePattern combines corrected months without changing the anchor', () => {
  const result = refinePattern(aprilDates.map(parseDate), mayDates.map(parseDate))

  assert.deepEqual(result.gapPattern, sffdLikePattern)
  assert.equal(result.anchorDate, '2026-04-01')
  assert.equal(result.confidence, 1)
})

test('getPredictionMonth follows the latest selected work day', () => {
  const selectedDates = ['2026-02-01', '2026-02-05', '2026-02-09'].map(parseDate)
  const predictionMonth = getPredictionMonth(selectedDates, parseDate('2026-04-15'))

  assert.equal(format(predictionMonth, 'yyyy-MM-dd'), '2026-03-01')
})

test('getPredictionMonth falls back when no valid work days are selected', () => {
  const predictionMonth = getPredictionMonth([], parseDate('2026-04-15'))

  assert.equal(format(predictionMonth, 'yyyy-MM-dd'), '2026-05-01')
})
