/**
 * Joins class names, skipping falsy values.
 *
 * There is no tailwind-merge in this project, so callers should not pass classes that
 * conflict with a component's own (e.g. two different `bg-*`): which one wins depends on
 * stylesheet order, not on the order here. Components expose props (variant, size, …)
 * for the common overrides instead.
 */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    out = out ? `${out} ${part}` : part
  }
  return out
}
