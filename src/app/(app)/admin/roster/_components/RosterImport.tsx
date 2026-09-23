'use client'

import { useMemo, useState, type ChangeEvent } from 'react'
import { Download, FileUp, Upload } from 'lucide-react'
import { Button, Card, ConfirmDialog, Field, Textarea, buttonClasses, cn, useToast } from '@/components/ui'
import { importRoster } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import type { ImportRosterResult } from '@/lib/types/database'
import { downloadTextFile, rosterTemplateCsv } from '../../_lib/csv'
import { plural } from '../../_lib/format'
import { buildRosterPreview } from '../_lib/preview'
import { ImportPreview } from './ImportPreview'
import { ImportResult } from './ImportResult'

/** Largest file accepted (a full department roster is far smaller). */
const MAX_FILE_BYTES = 5 * 1024 * 1024

interface Done {
  result: ImportRosterResult
  rowLines: number[]
  skippedInPreview: number
  replaced: boolean
}

export interface RosterImportProps {
  /** Called after a successful import (reload the list and counts). */
  onImported: () => void
}

/** Upload or paste a roster CSV, check the preview, then import it. */
export function RosterImport({ onImported }: RosterImportProps) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [source, setSource] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [replace, setReplace] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  const preview = useMemo(() => buildRosterPreview(text), [text])
  const canImport = !busy && !preview.fatal && preview.rows.length > 0

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = '' // so picking the same file again still triggers a change
    if (!file) return
    setFileError(null)
    setImportError(null)
    if (file.size > MAX_FILE_BYTES) {
      setFileError('That file is too big. Save the roster as a CSV (it should be well under 5 MB).')
      return
    }
    try {
      setText(await file.text())
      setSource(file.name)
    } catch {
      setFileError("Couldn't read that file. Save it as CSV and try again.")
    }
  }

  async function runImport() {
    setBusy(true)
    setImportError(null)
    try {
      const result = await importRoster(createClient(), preview.rows, { replace })
      setDone({ result, rowLines: preview.rowLines, skippedInPreview: preview.errorCount, replaced: replace })
      setText('')
      setSource(null)
      toast.success(
        'Roster imported',
        `${plural(result.inserted, 'person', 'people')} added, ${result.updated.toLocaleString('en-US')} updated.`,
      )
      onImported()
    } catch (err) {
      const message = toAppError(err).message
      setImportError(message)
      toast.error("Couldn't import the roster", message)
      throw err
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    setDone(null)
    setText('')
    setSource(null)
    setFileError(null)
    setImportError(null)
    setReplace(false)
  }

  if (done) {
    return (
      <ImportResult
        result={done.result}
        rowLines={done.rowLines}
        skippedInPreview={done.skippedInPreview}
        replaced={done.replaced}
        onDone={startOver}
      />
    )
  }

  return (
    <Card as="section" aria-labelledby="roster-import-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="roster-import-heading" className="font-display text-2xl leading-tight text-fg">
            Upload the roster
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            A CSV with a header row. Names are required; employee ID, rank, station, tour, email and phone help
            matching.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Download size={16} aria-hidden="true" />}
          onClick={() => downloadTextFile('shiftswap-roster-template.csv', rosterTemplateCsv())}
        >
          Download template
        </Button>
      </div>

      <div>
        <label
          className={buttonClasses({
            variant: 'secondary',
            fullWidth: true,
            className: 'cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-focus',
          })}
        >
          <FileUp size={18} aria-hidden="true" />
          Choose a CSV file
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            className="sr-only"
            onChange={(event) => void onFile(event)}
            disabled={busy}
          />
        </label>
        {source ? <p className="mt-2 text-sm text-fg-muted">Loaded {source}.</p> : null}
        {fileError ? (
          <p role="alert" className="mt-2 text-sm text-sffd-red-text">
            {fileError}
          </p>
        ) : null}
      </div>

      <Field
        label="Or paste it here"
        hint="Copy the cells from a spreadsheet (including the header row) and paste."
      >
        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setSource(null)
            setImportError(null)
          }}
          rows={5}
          spellCheck={false}
          placeholder="first_name,last_name,employee_id,rank,station,tour,email,phone"
          className="font-mono text-sm"
          disabled={busy}
        />
      </Field>

      {preview.fatal ? (
        <p role="alert" className="rounded-xl border border-sffd-red/30 bg-sffd-red/10 px-3 py-2 text-sm text-sffd-red-text">
          {preview.fatal}
        </p>
      ) : text.trim() ? (
        <ImportPreview preview={preview} />
      ) : null}

      {text.trim() && !preview.fatal ? (
        <div className="space-y-3 border-t border-line pt-4">
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
              disabled={busy}
              className="mt-0.5 h-5 w-5 shrink-0 accent-sffd-red"
            />
            <span>
              <span className="block font-medium text-fg">Replace the current roster</span>
              <span className="block text-sm text-fg-muted">
                Removes roster entries nobody has claimed yet, then adds this file. Entries linked to members are kept.
                Leave this off to add to and update the current roster.
              </span>
            </span>
          </label>

          {importError ? (
            <p role="alert" className="text-sm text-sffd-red-text">
              {importError}
            </p>
          ) : null}

          <Button
            fullWidth
            icon={<Upload size={18} aria-hidden="true" />}
            loading={busy}
            disabled={!canImport}
            onClick={() => {
              if (replace) setConfirming(true)
              else void runImport().catch(() => {})
            }}
          >
            {preview.rows.length ? `Import ${plural(preview.rows.length, 'person', 'people')}` : 'Nothing to import'}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={runImport}
        title="Replace the roster?"
        description="Every roster entry that no member has claimed is removed first, then this file is imported. Entries already linked to a member stay, and nobody loses their account."
        confirmLabel={`Replace and import ${plural(preview.rows.length, 'person', 'people')}`}
        tone="danger"
      />

      <p className={cn('text-xs text-fg-dim', busy && 'opacity-60')}>
        Ranks: Firefighter, Paramedic, Lieutenant, Captain, Battalion Chief, Division Chief. Stations by number (Airport
        stations as 101 to 103 or &ldquo;Airport 1&rdquo;). Tour 1 to 31, or blank for no tour.
      </p>
    </Card>
  )
}
