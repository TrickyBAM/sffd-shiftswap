'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import InstallPrompt from '@/components/InstallPrompt'
import PushToggle from '@/components/PushToggle'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { OnboardHeader } from '../../_components/OnboardHeader'
import { StepList, type WelcomeStep } from './StepList'
import { TelestaffStep } from './TelestaffStep'

export interface WelcomeStepsProps {
  /** The member already acknowledged the TeleStaff notice (start at step 2). */
  acknowledged: boolean
  firstName: string
}

const STEP_TITLES: Record<WelcomeStep, string> = {
  1: 'Before you start',
  2: 'Install the app',
  3: 'Turn on alerts',
}

export function WelcomeSteps({ acknowledged, firstName }: WelcomeStepsProps) {
  const router = useRouter()
  const [acked, setAcked] = useState(acknowledged)
  const [step, setStep] = useState<WelcomeStep>(acknowledged ? 2 : 1)
  const [leaving, setLeaving] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  // Move focus to the new step's heading so screen readers announce it
  // (not on first load, where focus stays at the top of the page).
  useEffect(() => {
    if (!moved.current) return
    headingRef.current?.focus()
  }, [step])

  function goTo(next: WelcomeStep) {
    moved.current = true
    setStep(next)
  }

  function finish() {
    if (leaving) return
    setLeaving(true)
    router.replace('/calendar')
  }

  return (
    <>
      <OnboardHeader title={firstName ? `Welcome, ${firstName}` : 'Welcome'} subtitle={`Step ${step} of 3`} />
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-6">
        <StepList current={step} acknowledged={acked} />

        <Card as="section" aria-labelledby="welcome-step-title" className="animate-fade-in-up space-y-4" key={step}>
          <h2
            id="welcome-step-title"
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-2xl leading-tight text-fg outline-none"
          >
            {STEP_TITLES[step]}
          </h2>

          {step === 1 ? (
            <TelestaffStep
              acknowledged={acked}
              onAcknowledged={() => {
                setAcked(true)
                goTo(2)
              }}
            />
          ) : null}

          {step === 2 ? (
            <>
              <p className="text-sm text-fg-muted">
                Put ShiftSwap on your home screen so it opens like an app. On iPhone this is also what makes alerts
                work.
              </p>
              <InstallPrompt showWhenInstalled />
              <Button size="lg" fullWidth onClick={() => goTo(3)}>
                Next
              </Button>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="text-sm text-fg-muted">
                Get a heads-up on this device when someone asks for your shift, a trade is confirmed, or a shift you
                could take is posted. You can change this any time on your Profile.
              </p>
              <PushToggle />
              <div className="space-y-3">
                <Button size="lg" fullWidth loading={leaving} onClick={finish}>
                  {leaving ? 'Opening ShiftSwap…' : 'Finish'}
                </Button>
                <Button variant="ghost" size="lg" fullWidth disabled={leaving} onClick={finish}>
                  Skip for now
                </Button>
              </div>
            </>
          ) : null}
        </Card>

        {step > 1 ? (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" disabled={leaving} onClick={() => goTo((step - 1) as WelcomeStep)}>
              Back
            </Button>
          </div>
        ) : null}
      </div>
    </>
  )
}
