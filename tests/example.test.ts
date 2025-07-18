import { describe, it, expect } from 'vitest'
import { SFFD_HIERARCHY } from '@/lib/hierarchy'

describe('SFFD hierarchy', () => {
  it('should have at least one division', () => {
    expect(Object.keys(SFFD_HIERARCHY).length).toBeGreaterThan(0)
  })
})