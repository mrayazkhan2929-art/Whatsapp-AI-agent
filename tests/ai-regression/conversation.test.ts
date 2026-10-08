import { beforeEach, expect, it, vi } from 'vitest'
import { detectPrimaryIntent, extractPropertyDetails } from '../../backend/src/modules/ai/intentDetector'
import { routeByIntent } from '../../backend/src/modules/ai/intentRouter'
import type { ContactMemory } from '../../backend/src/modules/contacts/contactMemory'
import { fakeSupabase } from '../support/fake-supabase'
import { companyProfileSchema } from '../../backend/src/modules/company/OrganizationProfileService'

const query = vi.hoisted(() => vi.fn())
const profileDb = vi.hoisted(() => ({ current: null as any }))
vi.mock('../../backend/src/config/supabase', () => ({ getSupabaseAdmin: () => profileDb.current }))
vi.mock('../../backend/src/modules/ai/handlers/propertyHandler', () => ({ queryProperties: query }))
const memory: ContactMemory = { language: 'en', intent: 'unknown', leadScore: 'cold', isFirstMessage: true, messageCount: 0 }
const turn = (message: string, state: Record<string, unknown> = {}) => routeByIntent({
  message, orgId: 'tenant-a', phoneNumber: 'fixture-contact', memory: state,
})

beforeEach(() => {
  query.mockImplementation(async (criteria) => ({ found: true, properties: [{ ref:criteria.referenceNumber ?? 'REF-A' }], count: 1, matchQuality: 'exact' }))
  profileDb.current = fakeSupabase({ organization_profiles: ['a', 'b'].map(tenant => ({ ...companyProfileSchema.parse({ legal_name: 'Company ' + tenant, office_address: 'Address ' + tenant }), org_id: 'tenant-' + tenant })) })
})

it('Hi enters the existing general AI path', async () => {
  expect(await turn('Hi')).toMatchObject({ type: 'defer_to_ai', language: 'en' })
  expect(query).not.toHaveBeenCalled()
})
it('office address uses the real company handler without property search', async () => {
  const result = await turn('office address')
  expect(result).toMatchObject({ type: 'direct', language: 'en' })
  if (result.type !== 'direct') throw new Error('Expected direct company response')
  expect(result.content).toContain('Address:')
  expect(query).not.toHaveBeenCalled()
})
it('2BR Dubai Marina under AED 2M forwards current structured criteria', async () => {
  expect(await turn('2BR Dubai Marina under AED 2M')).toMatchObject({ type: 'query', data: { found: true } })
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'tenant-a', area: 'Dubai Marina', bedrooms: '2', maxPrice: 2000000 }))
})
it('Connect me with an agent returns the existing handoff flag', async () => {
  expect(await turn('Connect me with an agent')).toMatchObject({ type: 'direct', metadata: { handoff: true } })
  expect(query).not.toHaveBeenCalled()
})

it('P4 exact REF-123 request reaches an exact lookup before area clarification', async () => {
  const result = await turn('Send me property REF-123')
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ referenceNumber:'REF-123',orgId:'tenant-a' }))
  expect(result).toMatchObject({ type: 'query', data: { found: true, properties: [{ ref: 'REF-123' }] } })
})

it('P4 another option stays in the property lane with existing criteria', async () => {
  const result = await turn('Do you have another option?', { area: 'Marina', bedrooms: '2', maxBudget: 2000000, lastShownPropertyRefs: 'REF-A' })
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ area:'Dubai Marina',bedrooms:'2',maxPrice:2000000,excludeRefs:['REF-A'] }))
  expect(result).toMatchObject({ type: 'query', data: { found: true } })
})

it('P4 Arabic property request extracts area, bedrooms, budget and transaction', () => {
  const message = 'أريد شراء شقة غرفتين في دبي مارينا بميزانية أقل من ٢ مليون درهم'
  expect(detectPrimaryIntent(message).intent).toBe('property')
  expect(extractPropertyDetails(message,memory)).toMatchObject({ area:'Dubai Marina',bedrooms:'2',maxPrice:2000000,transactionType:'SALE',propertyType:'apartment' })
})

it('P2 company facts differ between independently configured tenants', async () => {
  const first = await turn('office address')
  const second = await routeByIntent({ message: 'office address', orgId: 'tenant-b', phoneNumber: 'fixture-b', memory: {} })
  expect(first.type).toBe('direct')
  expect(second.type).toBe('direct')
  if (first.type !== 'direct' || second.type !== 'direct') throw new Error('Expected company responses')
  expect(first.content).toContain('Address a')
  expect(second.content).toContain('Address b')
  expect(first.content).not.toEqual(second.content)
  expect(first.content).not.toContain('Company b')
})
