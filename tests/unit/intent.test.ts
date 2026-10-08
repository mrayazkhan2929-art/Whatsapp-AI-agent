import { describe, expect, it } from 'vitest'
import { detectPrimaryIntent, extractPropertyDetails, parseBudget } from '../../backend/src/modules/ai/intentDetector'
import type { ContactMemory } from '../../backend/src/modules/contacts/contactMemory'

export const memory: ContactMemory = { language: 'en', intent: 'unknown', leadScore: 'cold', isFirstMessage: true, messageCount: 0 }

describe('deterministic intent and criteria baseline', () => {
  it.each([
    ['Hi', 'general'], ['office address', 'company'],
    ['2BR Dubai Marina under AED 2M', 'property'], ['Connect me with an agent', 'agent'],
  ])('%s routes to %s', (message, intent) => { expect(detectPrimaryIntent(message).intent).toBe(intent) })
  it.each([['AED 2M', 2000000], ['AED 750k', 750000], ['1,900,000', 1900000]])('parses %s', (input, expected) => {
    expect(parseBudget(input)).toBe(expected)
  })
  it('extracts English Marina, bedrooms and budget', () => {
    expect(extractPropertyDetails('2BR Dubai Marina under AED 2M', memory)).toMatchObject({ area: 'Dubai Marina', bedrooms: '2', maxPrice: 2000000 })
  })
  it('keeps prior area and bedrooms when the user supplies a budget', () => {
    expect(extractPropertyDetails('Max 2 million', { ...memory, area: 'Marina', bedrooms: '2' }))
      .toMatchObject({ area: 'Dubai Marina', bedrooms: '2', maxPrice: 2000000 })
  })
})
