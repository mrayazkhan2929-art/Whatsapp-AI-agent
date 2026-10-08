import { runtimeConfigResolver } from '../../company/RuntimeConfigResolver.js'
import { formatCompanyProfile } from '../../company/formatCompanyProfile.js'

/** Deterministic company answers; never fall back to another tenant or call a provider. */
export async function buildCompanyResponse(orgId: string, language: 'en' | 'ar') {
  const { companyProfile, companyConfigured } = await runtimeConfigResolver.resolve(orgId)
  return { type: 'company' as const, language, content: formatCompanyProfile(companyProfile, language),
    metadata: { configured: companyConfigured, address: companyProfile?.office_address ?? '', phone: companyProfile?.phone ?? '', email: companyProfile?.email ?? '', website: companyProfile?.website ?? '' } }
}
export async function getCompanyInfoAsString(orgId: string, language: 'en' | 'ar', message = ''): Promise<string> {
  if (/\b(owner|founder|ceo)\b/i.test(message)) {
    const { companyProfile } = await runtimeConfigResolver.resolve(orgId)
    const role = /\bceo\b/i.test(message) ? 'ceo' : /\bfounder\b/i.test(message) ? 'founder' : 'owner'
    const name = Object.entries(companyProfile?.company_facts ?? {}).find(([key]) => key.toLowerCase() === role)?.[1]
    return name ? (language === 'ar' ? `مسؤول الشركة: ${name}` : `Company leadership: ${name}`) : (language === 'ar' ? 'لم يتم إعداد معلومات قيادة الشركة بعد.' : 'Company leadership information has not been configured yet.')
  }
  return (await buildCompanyResponse(orgId, language)).content
}
