// Copy text to the clipboard: the async Clipboard API when allowed, then the
// old execCommand('copy') trick (older iOS Safari / non-secure contexts).
// Returns false when neither worked, so the caller can show the text for the
// member to select and copy by hand. Browser only.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or not focused: try the fallback.
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  // Off-screen but selectable; 16px so iOS doesn't zoom.
  Object.assign(area.style, { position: 'fixed', top: '0', left: '-9999px', opacity: '0', fontSize: '16px' })
  document.body.appendChild(area)
  let ok = false
  try {
    area.select()
    area.setSelectionRange(0, text.length)
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    area.remove()
    active?.focus({ preventScroll: true })
  }
  return ok
}
