// Text for the "Text it" button after an admin password reset.

/** First word of a full name ('' when there is none). */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * The text message offered after a password reset. The password sits on its
 * own line so a phone never glues punctuation onto it.
 */
export function tempPasswordMessage(firstName: string, password: string, origin: string): string {
  const signIn = origin ? `Sign in at ${origin}/login` : 'Sign in to ShiftSwap'
  return [
    `Hi ${firstName || 'there'}, I reset your ShiftSwap password. Your temporary password is:`,
    password,
    `${signIn} and you'll be asked to choose a new one.`,
  ].join('\n')
}
