import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, Flame } from 'lucide-react'

// Public and static: readable before signing up, and without Supabase configured.

export const metadata: Metadata = {
  title: 'Privacy & disclaimer',
  description: 'ShiftSwap is an unofficial tool made by SFFD members. What it stores and who can see it.',
}

const LAST_UPDATED = 'September 23, 2026'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-2xl tracking-wide text-fg">{title}</h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-fg-muted">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 pb-[calc(var(--safe-bottom)+3rem)] pt-safe md:px-6">
      <div className="flex min-h-16 items-center">
        <Link
          href="/calendar"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-medium text-fg-muted hover:text-fg"
        >
          <ChevronLeft size={20} aria-hidden="true" />
          Back to ShiftSwap
        </Link>
      </div>

      <header className="mb-6 mt-2">
        <div className="mb-3 flex items-center gap-2">
          <Flame size={24} aria-hidden="true" className="text-sffd-red-text" />
          <span className="font-display text-xl tracking-wide text-fg">
            SHIFT<span className="text-sffd-red-text">SWAP</span>
          </span>
        </div>
        <h1 className="font-display text-4xl tracking-wide text-fg md:text-5xl">Privacy &amp; disclaimer</h1>
        <p className="mt-1 text-sm text-fg-dim">Last updated {LAST_UPDATED}</p>
      </header>

      <div className="space-y-4">
        <Section title="An unofficial tool">
          <p>
            ShiftSwap was made by San Francisco Fire Department members to make it easier to find
            and arrange shift trades with each other.
          </p>
          <p>
            <strong className="text-fg">
              It is not an official application of the San Francisco Fire Department or the City
              and County of San Francisco,
            </strong>{' '}
            and it isn&apos;t run or endorsed by either.
          </p>
        </Section>

        <Section title="TeleStaff is the official record">
          <p>
            A trade you arrange in ShiftSwap is <strong className="text-fg">not final</strong>. Every
            trade still has to be entered and approved in TeleStaff, following SFFD policy.
          </p>
          <p>
            If ShiftSwap and TeleStaff ever disagree about who is working, TeleStaff is right. Always
            check TeleStaff before you count on a trade.
          </p>
        </Section>

        <Section title="What we store">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="text-fg">Your profile:</span> name, rank, station (and its battalion
              and division), tour, phone number, email, and your employee ID if you give it.
            </li>
            <li>
              <span className="text-fg">Your trades:</span> shifts you post, requests you send or
              receive, confirmed and cancelled trades, and your trade balances.
            </li>
            <li>
              <span className="text-fg">Messages</span> you send to another member about a shift.
            </li>
            <li>
              <span className="text-fg">Alerts</span> we send you, and, if you turn alerts on, the
              address your phone&apos;s browser gives us to deliver them.
            </li>
            <li>
              <span className="text-fg">Security records:</span> a log of account and admin actions,
              and a scrambled (hashed) copy of the network address used to sign up, to stop spam
              sign-ups.
            </li>
          </ul>
          <p>
            Your data is stored with the services that run the app: Vercel (the website) and
            Supabase (the database).
          </p>
        </Section>

        <Section title="Who can see it">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="text-fg">Approved members</span> can see posted shifts: the poster&apos;s
              name, rank and station, the date, and any notes.
            </li>
            <li>
              <span className="text-fg">Your phone number and email</span> are only shown to your trade
              partners (the member you&apos;re trading with, or who asked for your shift) and to admins.
            </li>
            <li>
              <span className="text-fg">Messages</span> are only visible to you and the other member in
              the conversation.
            </li>
            <li>
              <span className="text-fg">Admins</span> are members who run ShiftSwap. They can see member
              details so they can approve accounts, match people to the department roster, and fix
              problems.
            </li>
          </ul>
        </Section>

        <Section title="No ads, no tracking">
          <p>
            ShiftSwap has no ads and no analytics or tracking. We don&apos;t sell or share your
            information with anyone. The only cookies keep you signed in.
          </p>
        </Section>

        <Section title="Removing your account">
          <p>
            To have your account removed, contact an admin and ask. Shift and trade records that
            involve other members may be kept so their trade history stays accurate.
          </p>
          <p>If you turned on alerts, you can turn them off any time from your Profile.</p>
        </Section>
      </div>
    </main>
  )
}
