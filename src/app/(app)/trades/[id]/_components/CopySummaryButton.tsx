'use client'

import { useRef, useState } from 'react'
import { ClipboardCopy } from 'lucide-react'
import { Button, Card, CardHeader, Dialog, useToast } from '@/components/ui'
import { copyText } from '../_lib/clipboard'

export interface CopySummaryButtonProps {
  /** Plain text from buildTradeSummary(). */
  summary: string
}

/**
 * "Copy trade summary" for the paperwork / TeleStaff notes. When the phone
 * won't let us copy, the text is shown in a dialog to select by hand.
 */
export function CopySummaryButton({ summary }: CopySummaryButtonProps) {
  const toast = useToast()
  const [copying, setCopying] = useState(false)
  const [manual, setManual] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  async function copy() {
    setCopying(true)
    try {
      if (await copyText(summary)) {
        toast.success('Trade summary copied', 'Paste it into your paperwork or TeleStaff notes.')
      } else {
        setManual(true)
      }
    } finally {
      setCopying(false)
    }
  }

  return (
    <Card as="section" aria-labelledby="copy-summary-title">
      <CardHeader
        title={<span id="copy-summary-title">Paperwork</span>}
        description="Copy the trade details as plain text for TeleStaff or a trade slip."
      />
      <Button
        variant="secondary"
        fullWidth
        loading={copying}
        icon={<ClipboardCopy size={16} aria-hidden="true" />}
        onClick={copy}
      >
        Copy trade summary
      </Button>
      <details className="mt-3 rounded-xl border border-line px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-fg-muted">
          Preview
        </summary>
        <pre className="whitespace-pre-wrap break-words pb-3 font-sans text-sm text-fg">{summary}</pre>
      </details>

      <Dialog
        open={manual}
        onClose={() => setManual(false)}
        title="Copy the summary"
        description="Your phone didn't let ShiftSwap copy it. Select the text below and copy it."
        initialFocusRef={areaRef}
        actions={
          <Button variant="secondary" onClick={() => setManual(false)}>
            Done
          </Button>
        }
      >
        <label htmlFor="trade-summary-text" className="sr-only">
          Trade summary
        </label>
        <textarea
          id="trade-summary-text"
          ref={areaRef}
          readOnly
          rows={9}
          value={summary}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 block w-full rounded-xl border border-line-strong bg-elevated px-3 py-2 text-base text-fg"
        />
      </Dialog>
    </Card>
  )
}
