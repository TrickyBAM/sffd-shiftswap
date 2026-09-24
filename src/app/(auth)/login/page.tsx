import type { Metadata } from 'next'
import { nextFromSearchParam } from '../_lib/safe-next'
import { LoginForm } from './_components/LoginForm'

export const metadata: Metadata = {
  title: 'Log in',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { next } = await searchParams
  return <LoginForm next={nextFromSearchParam(next)} />
}
