import { beforeEach, expect, it, vi } from 'vitest'
import { queryProperties } from '../../backend/src/modules/ai/handlers/propertyHandler'

const matcher = vi.hoisted(() => ({ searchCanonical:vi.fn(), searchWaterfall: vi.fn(), search: vi.fn(), logInventoryGap: vi.fn(), normalizeArea: vi.fn((area: string) => area) }))
vi.mock('../../backend/src/properties/PropertyMatcher', () => ({ PropertyMatcher: class {
  searchWaterfall = matcher.searchWaterfall
  searchCanonical=matcher.searchCanonical
  search = matcher.search
  logInventoryGap = matcher.logInventoryGap
  normalizeArea = matcher.normalizeArea
} }))

// Fixtures only: REF-D deliberately differs in property type while matching area/budget/bedrooms.
const fixtures = [
  { ref: 'REF-A', type: 'apartment', district: 'Marina', bedrooms: '2', price_aed: 1900000 },
  { ref: 'REF-D', type: 'villa', district: 'Marina', bedrooms: '2', price_aed: 1700000 },
]
beforeEach(() => {
  matcher.searchCanonical.mockImplementation(async (_orgId,criteria) => {
    const properties = fixtures.filter((p) => !criteria.propertyType || p.type === criteria.propertyType)
    return { properties, source: 'direct', directCount: properties.length, indirectCount: 0, usedFallback: false }
  })
  matcher.search.mockResolvedValue([])
})
it('property handler preserves tenant scope, bedrooms and budget at the matcher boundary', async () => {
  await queryProperties({ orgId: 'tenant-a', area: 'Marina', bedrooms: '2', maxPrice: 2000000 })
  expect(matcher.searchCanonical).toHaveBeenCalledWith('tenant-a',expect.objectContaining({ area: 'Marina', bedrooms: '2', maxPrice: 2000000 }),3,undefined)
})
it('P4 apartment criterion excludes same-area same-budget villas', async () => {
  const result = await queryProperties({ orgId: 'tenant-a', area: 'Marina', bedrooms: '2', maxPrice: 2000000, category: 'apartment' })
  expect(result.found).toBe(true)
  expect(result.properties?.map(p=>p.ref)).toEqual(['REF-A'])
})

it('empty verified inventory produces no fabricated properties', async () => {
  matcher.searchCanonical.mockResolvedValue({ properties: [], source: 'none', directCount: 0, indirectCount: 0, usedFallback: false })
  const result = await queryProperties({ orgId: 'tenant-a', area: 'Marina' })
  expect(result.found).toBe(false)
  expect(result.properties).toBeUndefined()
})
