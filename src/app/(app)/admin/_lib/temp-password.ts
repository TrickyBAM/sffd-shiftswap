// Temporary passwords for admin password resets (ARCHITECTURE §1 "Email":
// forgotten passwords are reset by an admin with a temporary password and a
// forced change at the next sign-in).
//
// Format: Word-Word-1234 — two different capitalised words from the list
// below plus four digits, e.g. "Harbor-Maple-4821". Easy to read aloud or
// text; 16–20 characters; upper case, lower case, digits and a symbol, so it
// passes any password-strength setting. Randomness comes from the Web Crypto
// API (rejection sampling, no modulo bias). The member must replace it on
// their next sign-in, so it only has to survive a short window.

/** Plain, unambiguous words (5–7 letters) that are easy to spell over the phone. */
export const TEMP_PASSWORD_WORDS: readonly string[] = Object.freeze([
  'amber', 'anchor', 'apple', 'arrow', 'aspen', 'badge', 'banner', 'basin', 'beacon', 'berry',
  'birch', 'blaze', 'bridge', 'brook', 'bucket', 'cabin', 'candle', 'canyon', 'cedar', 'chalk',
  'cherry', 'cider', 'cliff', 'clover', 'cobalt', 'comet', 'copper', 'coral', 'cotton', 'crane',
  'cricket', 'crystal', 'daisy', 'delta', 'desert', 'dolphin', 'dragon', 'eagle', 'ember', 'falcon',
  'feather', 'field', 'forest', 'fossil', 'galaxy', 'garden', 'garnet', 'ginger', 'glacier',
  'granite', 'grove', 'harbor', 'hazel', 'helmet', 'heron', 'hickory', 'honey', 'island',
  'ivory', 'jasper', 'jungle', 'kettle', 'ladder', 'lagoon', 'lantern', 'lemon', 'linen', 'lotus',
  'magnet', 'maple', 'marble', 'meadow', 'meteor', 'mirror', 'morning', 'nickel',
  'nutmeg', 'oasis', 'ocean', 'olive', 'orange', 'orchid', 'otter', 'paddle', 'panda', 'pebble',
  'pepper', 'pillar', 'planet', 'plaza', 'pocket', 'prairie', 'quartz', 'rabbit', 'radio',
  'raven', 'ribbon', 'river', 'rocket', 'saddle', 'salmon', 'sequoia', 'shadow', 'silver', 'sparrow',
  'spruce', 'summit', 'sunset', 'tango', 'thunder', 'timber', 'tulip', 'valley', 'velvet', 'walnut',
  'willow', 'window', 'winter', 'yellow', 'zephyr',
].filter((word) => word.length >= 5 && word.length <= 7))

/** Minimum length of a generated password. */
export const TEMP_PASSWORD_MIN_LENGTH = 12

/** A uniformly random integer in [0, max) from the Web Crypto API. */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x1_0000_0000) {
    throw new RangeError(`secureRandomInt: max must be an integer from 1 to 2^32, got ${max}`)
  }
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random numbers are not available.')
  // Reject values from the incomplete top range so every result is equally likely.
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buffer = new Uint32Array(1)
  for (;;) {
    cryptoApi.getRandomValues(buffer)
    if (buffer[0] < limit) return buffer[0] % max
  }
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * A new readable temporary password such as "Harbor-Maple-4821".
 * `randomInt(max)` must return an integer in [0, max); tests may pass their own.
 */
export function generateTempPassword(randomInt: (max: number) => number = secureRandomInt): string {
  const words = TEMP_PASSWORD_WORDS
  const first = words[randomInt(words.length)]
  let second = words[randomInt(words.length)]
  // Two different words; with a fixed test generator, fall back to the next word.
  for (let tries = 0; second === first && tries < 8; tries++) second = words[randomInt(words.length)]
  if (second === first) second = words[(words.indexOf(first) + 1) % words.length]
  const digits = String(randomInt(10_000)).padStart(4, '0')
  const password = `${capitalise(first)}-${capitalise(second)}-${digits}`
  if (password.length < TEMP_PASSWORD_MIN_LENGTH) {
    // Unreachable with 5+ letter words; kept as a guard if the list changes.
    throw new Error('Generated password is too short.')
  }
  return password
}
