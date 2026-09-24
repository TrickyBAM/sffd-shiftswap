import type { Metadata } from 'next'
import { connection } from 'next/server'
import { getServerEnv } from '@/lib/env'
import { issueFormToken } from './_lib/guard'
import { SignupForm } from './_components/SignupForm'

export const metadata: Metadata = {
  title: 'Create account',
}

export default async function SignupPage() {
  // Rendered per request: the form token records when this page was served.
  await connection()

  let token = ''
  try {
    token = issueFormToken(getServerEnv().supabaseSecretKey)
  } catch {
    // Server keys missing: the form still renders and the sign-up action
    // reports the configuration problem when submitted.
  }

  return <SignupForm token={token} />
}
