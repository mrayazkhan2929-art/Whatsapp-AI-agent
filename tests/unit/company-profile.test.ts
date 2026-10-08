import { beforeEach, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../support/fake-supabase'
import { companyProfileSchema, organizationProfileService } from '../../backend/src/modules/company/OrganizationProfileService'
import { runtimeConfigResolver } from '../../backend/src/modules/company/RuntimeConfigResolver'
import { getCompanyInfoAsString } from '../../backend/src/modules/ai/handlers/companyHandler'
import { sanitize } from '../../backend/src/modules/ai/aiService'
import { buildPrompt } from '../../backend/src/modules/ai/promptBuilder'
import { buildIERESystemPrompt } from '../../frontend/src/lib/prompts/iereSystemPrompt'
import { detectPrimaryIntent } from '../../backend/src/modules/ai/intentDetector'

const dependency = vi.hoisted(() => ({ db: null as any }))
vi.mock('../../backend/src/config/supabase', () => ({ getSupabaseAdmin: () => dependency.db, isSupabaseConfigured: () => false }))
beforeEach(() => { dependency.db = fakeSupabase({ organization_profiles: [{ ...companyProfileSchema.parse({ legal_name: 'A Brand', office_address: 'A Tower', website: 'https://a.example', phone: '+11111' }), org_id: 'a' }, { ...companyProfileSchema.parse({ legal_name: 'B Brand', office_address: 'B Tower' }), org_id: 'b' }] }) })

it('resolves only the supplied server tenant, with no global default', async () => {
  expect(await runtimeConfigResolver.resolve('a')).toMatchObject({ orgId: 'a', companyConfigured: true, companyProfile: { legal_name: 'A Brand' } })
  expect(await runtimeConfigResolver.resolve('missing')).toEqual({ orgId: 'missing', companyConfigured: false, companyProfile: null })
  expect(await getCompanyInfoAsString('missing', 'en')).toContain('not been configured')
  expect(await getCompanyInfoAsString('missing', 'ar')).toContain('لم يتم')
  await expect(runtimeConfigResolver.resolve('')).rejects.toThrow('scope')
})
it('strips forged IDs and timestamps at the service write boundary', async () => {
  await organizationProfileService.save('a', { ...companyProfileSchema.parse({ legal_name: 'Updated A' }), org_id: 'b', created_at: 'forged' } as any)
  expect(dependency.db.tables.organization_profiles).toHaveLength(2)
  expect((await organizationProfileService.get('b'))?.legal_name).toBe('B Brand')
  expect((await organizationProfileService.get('a'))?.legal_name).toBe('Updated A')
  expect(dependency.db.queries.at(-1).filters).toContainEqual(['eq', 'org_id', 'a'])
})
it('does not share cached company configuration and applies the next saved change', async () => {
  expect(await getCompanyInfoAsString('a', 'en')).toContain('A Tower')
  await organizationProfileService.save('a', companyProfileSchema.parse({ legal_name: 'New A', office_address: 'New office' }))
  expect(await getCompanyInfoAsString('a', 'en')).toContain('New office')
  expect(await getCompanyInfoAsString('b', 'en')).toContain('B Tower')
})
it('does not substitute legacy domains or office locations in the sanitizer', () => {
  const text = 'Boulevard Plaza https://iere.ae Our office is located in Dubai.'
  expect(sanitize(text)).toBe(text)
})
it('uses only configured leadership facts, with no hardcoded CEO fallback', async () => {
  expect(await getCompanyInfoAsString('a', 'en', 'Who owns your company?')).not.toContain('Imran')
  expect(await getCompanyInfoAsString('a', 'en', 'Who is the owner of your company?')).toContain('not been configured')
  await organizationProfileService.save('a', companyProfileSchema.parse({ legal_name: 'A', company_facts: { owner: 'A owner' } }))
  expect(await getCompanyInfoAsString('a', 'en', 'company owner')).toContain('A owner')
  expect(await getCompanyInfoAsString('a', 'en', 'Who is your CEO?')).toContain('not been configured')
})
it.each([{ legal_name: '' }, { legal_name: 'A', logo_url: 'javascript:alert(1)' }, { legal_name: 'A', website: 'file:///private' }, { legal_name: 'A', timezone: 'Invalid/Zone' }, { legal_name: 'A', email: 'invalid' }, { legal_name: 'A', service_areas: Array(51).fill('Area') }, { legal_name: 'A', social_links: { social: 'data:image/png,x' } }])('validates bounded profile fields and safe URLs: %j', payload => {
  expect(companyProfileSchema.safeParse(payload).success).toBe(false)
})
it('surfaces database failures instead of returning fabricated facts', async () => {
  dependency.db = { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null, error: { message: 'offline' } }) }) }
  await expect(organizationProfileService.get('a')).rejects.toThrow('offline')
})
it('both prompt builders consume tenant company facts', async () => {
  const profile = await organizationProfileService.get('a')
  const backend = buildPrompt({ lane: 'GENERAL', lang: 'en', intent: {} }, 0, profile).systemPrompt
  const frontend = buildIERESystemPrompt({ companyProfile: profile, propertyContext: '', contactMemory: '', todayDate: 'fixture', language: 'en', propertySource: 'none', directCount: 0, indirectCount: 0 })
  for (const prompt of [backend, frontend]) { expect(prompt).toContain('A Brand'); expect(prompt).toContain('A Tower'); expect(prompt).not.toMatch(/Investment Experts|Concord Tower|investmentexperts\.ae|B Brand/) }
})
it('company CEO, logo and Arabic contact questions use company facts while property searches retain their lane', () => {
  for (const message of ['Who is your CEO?', 'company logo', 'ما هو رقم الهاتف؟']) expect(detectPrimaryIntent(message).intent).toBe('company')
  expect(detectPrimaryIntent('Show me properties in Marina address').intent).toBe('property')
})
