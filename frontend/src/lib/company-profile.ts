export interface CompanyProfile {
  org_id: string; legal_name: string; short_name: string; description: string; logo_url: string
  office_address: string; map_url: string; website: string; email: string; phone: string; whatsapp: string
  timezone: string; working_hours: { summary: string }; service_areas: string[]
  license_number: string; license_authority: string; social_links: Record<string, string>; company_facts: Record<string, string>
  legal_disclaimer: string; approved_marketing_statements: string[]; created_at: string; updated_at: string
}
export type CompanyProfileDraft = Omit<CompanyProfile, 'org_id' | 'created_at' | 'updated_at'>
export const emptyCompanyProfile: CompanyProfileDraft = {
  legal_name: '', short_name: '', description: '', logo_url: '', office_address: '', map_url: '', website: '', email: '', phone: '', whatsapp: '',
  timezone: 'UTC', working_hours: { summary: '' }, service_areas: [], license_number: '', license_authority: '', social_links: {}, company_facts: {}, legal_disclaimer: '', approved_marketing_statements: [],
}
export async function fetchCompanyProfile(): Promise<CompanyProfile | null> {
  const response = await fetch('/api/settings/company-profile', { credentials: 'include', cache: 'no-store' })
  if (!response.ok) throw new Error('Company profile could not be loaded')
  return ((await response.json()) as { data: CompanyProfile | null }).data
}
export async function saveCompanyProfile(profile: CompanyProfileDraft): Promise<CompanyProfile> {
  const response = await fetch('/api/settings/company-profile', { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile) })
  const payload = await response.json()
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message ?? 'Company profile could not be saved')
  return payload.data
}
