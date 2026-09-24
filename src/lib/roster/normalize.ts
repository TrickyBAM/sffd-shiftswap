// Name normalisation for roster matching (ARCHITECTURE §6.1, §6.4).
//
// nameKey() MUST produce exactly the same result as SQL public.name_key():
//   1. lowercase
//   2. replace accented Latin letters:
//        áàâäãå→a  éèêë→e  íìîï→i  óòôöõø→o  úùûü→u  ñ→n  ç→c  ýÿ→y
//   3. remove every character that is not a–z
// An empty result stays ''. tests/fixtures/name-keys.json holds shared cases
// that both implementations are tested against.

const ACCENT_MAP: Readonly<Record<string, string>> = {
  á: 'a', à: 'a', â: 'a', ä: 'a', ã: 'a', å: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', ö: 'o', õ: 'o', ø: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ñ: 'n',
  ç: 'c',
  ý: 'y', ÿ: 'y',
}

const ACCENT_RE = /[áàâäãåéèêëíìîïóòôöõøúùûüñçýÿ]/g

/** "O'Brien-Smith" → "obriensmith", "José" → "jose", "  " → "". */
export function nameKey(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(ACCENT_RE, (ch) => ACCENT_MAP[ch] ?? ch)
    .replace(/[^a-z]/g, '')
}

export interface SplitName {
  first: string
  /** Everything between first and last (middle names/initials), may be ''. */
  middle: string
  last: string
}

// Generational suffixes dropped from the end of a "First … Last" name.
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/** Trims and collapses internal whitespace. */
export function cleanName(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function isSuffix(token: string): boolean {
  return SUFFIXES.has(token.toLowerCase().replace(/[^a-z]/g, ''))
}

function tokensOf(text: string): string[] {
  return cleanName(text).split(' ').filter(Boolean)
}

/** Removes trailing generational suffixes while more than `keep` tokens remain. */
function dropSuffixes(tokens: string[], keep: number): string[] {
  let out = tokens
  while (out.length > keep && isSuffix(out[out.length - 1])) out = out.slice(0, -1)
  return out
}

/**
 * Splits a full name into first / middle / last, matching the rule used by
 * roster matching (§6.4: first token = first name, last token = last name):
 *   'John Smith'          → John / '' / Smith
 *   'John Q. Smith'       → John / Q. / Smith
 *   'Smith, John Q.'      → John / Q. / Smith   ("Last, First" form)
 *   'De La Cruz, Maria'   → Maria / '' / De La Cruz
 *   'John Smith Jr.'      → John / '' / Smith   (Jr/Sr/II/III/IV/V dropped)
 *   'Cher'                → Cher / '' / ''
 * Returns null for an empty/blank input.
 */
export function splitFullName(full: string | null | undefined): SplitName | null {
  const text = cleanName(full)
  if (!text) return null

  const comma = text.indexOf(',')
  if (comma >= 0) {
    // "Last, First Middle" — also tolerates 'Smith Jr., John' and 'Smith, John, Jr.'
    const lastTokens = dropSuffixes(tokensOf(text.slice(0, comma)), 1)
    let rest = tokensOf(text.slice(comma + 1).replace(/,/g, ' '))
    while (rest.length > 1 && isSuffix(rest[0])) rest = rest.slice(1)
    rest = dropSuffixes(rest, 1)
    if (lastTokens.length === 0) {
      // ', John' — treat the remainder as "First … Last".
      return rest.length ? splitFullName(rest.join(' ')) : null
    }
    const last = lastTokens.join(' ')
    if (rest.length === 0) return { first: last, middle: '', last: '' }
    return { first: rest[0], middle: rest.slice(1).join(' '), last }
  }

  const tokens = dropSuffixes(tokensOf(text), 2)
  if (tokens.length === 1) return { first: tokens[0], middle: '', last: '' }
  return {
    first: tokens[0],
    middle: tokens.slice(1, -1).join(' '),
    last: tokens[tokens.length - 1],
  }
}
