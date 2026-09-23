import Link from 'next/link'
import { SearchX } from 'lucide-react'
import AppHeader from '@/components/AppHeader'
import { EmptyState, buttonClasses } from '@/components/ui'

/** Shown when /trades/<id> doesn't exist or isn't visible to this member. */
export default function TradeNotFound() {
  return (
    <>
      <AppHeader title="Not found" back={{ href: '/trades', label: 'Back to Trades' }} />
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-4 md:px-6">
        <EmptyState
          icon={<SearchX size={28} />}
          title="We couldn't find that shift"
          description="The link may be wrong, or the shift was removed. Your trades and the open shifts are still on the Trades and Board tabs."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/trades" className={buttonClasses({ variant: 'primary' })}>
                Go to my trades
              </Link>
              <Link href="/board" className={buttonClasses({ variant: 'secondary' })}>
                Open the board
              </Link>
            </div>
          }
        />
      </div>
    </>
  )
}
