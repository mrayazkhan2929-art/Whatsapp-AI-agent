import { describe, expect, it } from 'vitest'
import { structuredIntentClassifier } from '../../backend/src/modules/ai/StructuredIntentClassifier'
import { normalizeArea } from '../../backend/src/properties/PropertySearchCriteria'

describe('CSV listing references', () => {
  it.each(['IVRE/IE/38923', '102860-497wnQ', '102860-1SYqFs', 'ivre/taz12/7862'])('recognizes %s without interpreting its digits as a budget', reference => {
    for (const message of [reference, `Show property ref ${reference}`]) {
      const intent = structuredIntentClassifier.classify(message)
      expect(intent.patch).toEqual({ referenceNumber: reference })
      expect(structuredIntentClassifier.merge(intent, { excludeRefs: [] })).toEqual({ referenceNumber: reference, excludeRefs: [] })
    }
  })
  it('retains a separate explicit budget beside a reference', () => {
    expect(structuredIntentClassifier.classify('Show ref 102860-497wnQ under AED 2000000').patch).toEqual({ referenceNumber: '102860-497wnQ', maxPrice: 2000000 })
  })
  it('preserves numeric ranges as budgets when they are not references', () => {
    expect(structuredIntentClassifier.classify('property budget 750000-1500000').patch).toEqual({ minPrice: 750000, maxPrice: 1500000 })
  })
  it('does not classify ordinary hyphenated words as references', () => {
    expect(structuredIntentClassifier.classify('hello good-morning').patch).toEqual({})
  })
  it.each([
    ['Jumeirah Village Circle (JVC)', 'JVC'],
    ['Jumeirah Lake Towers (JLT)', 'JLT'],
    ['Jumeirah Village Triangle (JVT)', 'JVT'],
    ['Dubai Silicon Oasis (DSO)', 'Dubai Silicon Oasis'],
    ['DAMAC Hills 2 (Akoya by DAMAC)', 'DAMAC Hills 2 (Akoya by DAMAC)'],
  ])('normalizes a known exported district alias in %s', (district, expected) => {
    expect(normalizeArea(district)).toBe(expected)
  })
})
