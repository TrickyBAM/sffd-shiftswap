import type { Metadata } from 'next'
import AppHeader from '@/components/AppHeader'
import { PostView } from './_components/PostView'

export const metadata: Metadata = {
  title: 'Post a shift',
}

interface PostPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** Post one of my shifts (ARCHITECTURE §7.1, §7.2). ?date=YYYY-MM-DD preselects a day. */
export default async function PostPage({ searchParams }: PostPageProps) {
  const { date } = await searchParams
  const initialDate = typeof date === 'string' ? date : null
  return (
    <>
      <AppHeader title="Post a Shift" subtitle="Find someone to cover you" />
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 md:px-6">
        {/* A new ?date= starts a fresh form. */}
        <PostView key={initialDate ?? ''} initialDate={initialDate} />
      </div>
    </>
  )
}
