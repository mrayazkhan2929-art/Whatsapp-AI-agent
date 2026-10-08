import { z } from 'zod'
import { getSupabaseAdmin } from '../../config/supabase.js'

const text = (max: number) => z.string().trim().max(max)
const url = text(2000).refine(value => !value || /^https?:\/\//i.test(value) && URL.canParse(value), 'Use a valid HTTP or HTTPS URL')
const list = z.array(text(500).min(1)).max(50)
export const companyProfileSchema = z.object({
  legal_name: text(200).min(1, 'Company name is required'), short_name: text(100).default(''),
  description: text(4000).default(''), logo_url: url.default(''), office_address: text(2000).default(''),
  map_url: url.default(''), website: url.default(''), email: z.union([z.literal(''), z.string().trim().email().max(320)]).default(''),
  phone: text(80).default(''), whatsapp: text(80).default(''),
  timezone: text(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, 'Choose a valid timezone').default('UTC'),
  working_hours: z.object({ summary: text(1000).default('') }).default({ summary: '' }),
  service_areas: list.default([]), license_number: text(200).default(''), license_authority: text(200).default(''),
  social_links: z.record(text(80).min(1), url).refine(value => Object.keys(value).length <= 15, 'Maximum 15 social links').default({}),
  company_facts: z.record(text(80).min(1), text(2000)).refine(value => Object.keys(value).length <= 30, 'Maximum 30 company facts').default({}),
  legal_disclaimer: text(4000).default(''), approved_marketing_statements: list.default([]),
})
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>
export type OrganizationProfile = CompanyProfileInput & { org_id: string; created_at: string; updated_at: string }

export class OrganizationProfileService {
  async get(orgId: string): Promise<OrganizationProfile | null> {
    if (!orgId) throw new Error('Organization scope is required')
    const { data, error } = await getSupabaseAdmin().from('organization_profiles').select('*').eq('org_id', orgId).maybeSingle<OrganizationProfile>()
    if (error) throw new Error(`Company profile lookup failed: ${error.message}`)
    return data
  }
  async save(orgId: string, input: CompanyProfileInput): Promise<OrganizationProfile> {
    if (!orgId) throw new Error('Organization scope is required')
    const profile = companyProfileSchema.parse(input)
    const { data, error } = await getSupabaseAdmin().from('organization_profiles')
      .upsert({ ...profile, org_id: orgId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
      .select('*').single<OrganizationProfile>()
    if (error) throw new Error(`Company profile save failed: ${error.message}`)
    return data
  }
}
export const organizationProfileService = new OrganizationProfileService()
