// What the sign-up server action returns. Never an exception: every failure
// comes back as a friendly message (optionally tied to one field).

export type SignupField = 'fullName' | 'email' | 'phone' | 'password'

export type SignupResult =
  | { ok: true }
  | {
      ok: false
      /** Plain-English message to show. */
      message: string
      /** The field the message is about, when there is one. */
      field?: SignupField
      /** 'refresh' when the page itself must be reloaded before trying again. */
      retry?: 'refresh'
      /** 'account-exists' when the email is already registered (offer "Log in"). */
      code?: 'account-exists'
    }

const FIELDS: readonly SignupField[] = ['fullName', 'email', 'phone', 'password']

export function isSignupField(value: unknown): value is SignupField {
  return typeof value === 'string' && (FIELDS as readonly string[]).includes(value)
}
