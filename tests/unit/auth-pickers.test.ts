import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NO_TOUR_LABEL, StationPicker, TourPicker, TourPreview } from '@/components/pickers'
import { tourDaysInRange } from '@/lib/sffd/tours'

// Server-rendered markup checks for the shared pickers (the contract other
// screens rely on). No DOM needed: React renders <select value> as a
// `selected` option.

const noop = () => {}

function selectedOptions(html: string): string[] {
  return [...html.matchAll(/<option[^>]*selected=""[^>]*>([^<]*)<\/option>/g)].map((m) => m[1])
}

describe('StationPicker', () => {
  it('shows the battalion and division that a station implies', () => {
    const html = renderToStaticMarkup(createElement(StationPicker, { value: 19, onChange: noop }))
    expect(selectedOptions(html)).toEqual(['Division 3', 'Battalion 9', 'Station 19'])
  })

  it('lists only that battalion’s stations once one is chosen', () => {
    const html = renderToStaticMarkup(createElement(StationPicker, { value: 101, onChange: noop }))
    expect(selectedOptions(html)).toEqual(['Airport Division', 'Airport Battalion', 'Airport Station 1'])
    expect(html).toContain('Airport Station 3')
    expect(html).not.toContain('>Station 19<')
  })

  it('starts empty with every station available and binds the id and error to the station select', () => {
    const html = renderToStaticMarkup(
      createElement(StationPicker, { id: 'st', label: 'Your station', value: null, onChange: noop, error: 'Choose your station.' }),
    )
    expect(html).toContain('<legend')
    expect(html).toContain('Your station')
    expect(html).toContain('Choose station')
    expect(html).toContain('>Station 19<')
    expect(html).toContain('>Airport Station 2<')
    expect(html).toMatch(/<label[^>]*for="st"/)
    expect(html).toMatch(/<select[^>]*id="st"[^>]*aria-invalid="true"|<select[^>]*aria-invalid="true"[^>]*id="st"/)
    expect(html).toContain('Choose your station.')
  })

  it('can be disabled', () => {
    const html = renderToStaticMarkup(createElement(StationPicker, { value: 19, onChange: noop, disabled: true }))
    expect(html.match(/<select[^>]*disabled=""/g)?.length).toBe(3)
  })
})

describe('TourPicker', () => {
  it('offers tours 1–31, plus "No tour" only when allowed', () => {
    const plain = renderToStaticMarkup(createElement(TourPicker, { value: null, onChange: noop }))
    expect(plain).toContain('>Tour 31<')
    expect(plain).not.toContain(NO_TOUR_LABEL)
    expect(plain).toContain('Choose your tour')

    const withNone = renderToStaticMarkup(createElement(TourPicker, { value: null, onChange: noop, allowNone: true }))
    expect(selectedOptions(withNone)).toEqual([NO_TOUR_LABEL])
  })

  it('shows a two-month preview of the chosen tour’s work days', () => {
    const html = renderToStaticMarkup(createElement(TourPicker, { value: 7, onChange: noop, showPreview: true }))
    expect(selectedOptions(html)).toEqual(['Tour 7'])
    expect(html).toContain('Tour 7 work days')
  })

  it('previews exactly the tour’s work days in each month', () => {
    const html = renderToStaticMarkup(createElement(TourPreview, { tour: 2, from: '2026-09-23' }))
    expect(html).toContain('September 2026')
    expect(html).toContain('October 2026')
    const sepDays = tourDaysInRange(2, '2026-09-01', '2026-09-30')
    // 2026-09-23 is Watch 2, so Tour 2 works it.
    expect(sepDays).toContain('2026-09-23')
    const red = html.match(/bg-cal-work font-semibold/g) ?? []
    const octDays = tourDaysInRange(2, '2026-10-01', '2026-10-31')
    expect(red.length).toBe(sepDays.length + octDays.length)
  })

  it('explains "No tour" and the not-chosen state', () => {
    expect(renderToStaticMarkup(createElement(TourPreview, { tour: null }))).toContain('No tour')
    expect(renderToStaticMarkup(createElement(TourPreview, { tour: undefined }))).toContain('Pick your tour')
  })
})
