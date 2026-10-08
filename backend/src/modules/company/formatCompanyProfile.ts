import type { OrganizationProfile } from './OrganizationProfileService.js'

export function formatCompanyProfile(profile: OrganizationProfile | null, language: 'en' | 'ar' = 'en'): string {
  if (!profile) return language === 'ar' ? 'لم يتم إعداد معلومات الشركة بعد. يرجى التواصل مع فريق العمل للحصول على التفاصيل المؤكدة.' : 'Company information has not been configured yet. Please contact the team for verified details.'
  const labels = language === 'ar'
    ? ['العنوان', 'الهاتف', 'البريد الإلكتروني', 'الموقع الإلكتروني', 'الخريطة', 'ساعات العمل', 'المنطقة الزمنية', 'واتساب', 'مناطق الخدمة', 'الترخيص', 'جهة الترخيص', 'إخلاء المسؤولية', 'الشعار']
    : ['Address', 'Phone', 'Email', 'Website', 'Map', 'Hours', 'Timezone', 'WhatsApp', 'Service areas', 'License', 'License authority', 'Disclaimer', 'Logo']
  const values = [profile.office_address, profile.phone, profile.email, profile.website, profile.map_url, profile.working_hours.summary, profile.timezone, profile.whatsapp, profile.service_areas.join(', '), profile.license_number, profile.license_authority, profile.legal_disclaimer, profile.logo_url]
  return [`🏢 *${profile.legal_name}*`, profile.short_name, profile.description,
    ...values.map((value, index) => value ? `*${labels[index]}:* ${value}` : ''),
    ...Object.entries(profile.social_links).map(([key, value]) => `${key}: ${value}`),
    ...Object.entries(profile.company_facts).map(([key, value]) => `${key}: ${value}`),
    ...profile.approved_marketing_statements,
  ].filter(Boolean).join('\n')
}
