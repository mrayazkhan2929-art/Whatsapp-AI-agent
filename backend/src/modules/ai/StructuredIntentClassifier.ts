import { AREA_ALIASES, criteriaFromLegacy, propertySearchCriteriaSchema, type PropertySearchCriteria } from '../../properties/PropertySearchCriteria.js'

export function normalizeStructuredText(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.includes(digit) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(digit) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٬,]/g, '').replace(/٫/g, '.').toLowerCase()
}
const amount = (number: string, unit?: string) => Number(number) * (/^(m|million|mn|مليون|ملايين)$/.test(unit ?? '') ? 1e6 : /^(k|thousand|ألف|الف|آلاف)$/.test(unit ?? '') ? 1e3 : 1)
export function extractBudgetBounds(text: string): { minPrice?: number; maxPrice?: number } {
  const raw = normalizeStructuredText(text)
  const unit = '(million|thousand|mn|مليون|ملايين|ألف|الف|آلاف|m|k)'
  const range = raw.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + unit + '?\\s*(?:-|to|and|إلى|الى)\\s*(\\d+(?:\\.\\d+)?)\\s*' + unit + '?'))
  if (range) return { minPrice: amount(range[1], range[2] ?? range[4]), maxPrice: amount(range[3], range[4] ?? range[2]) }
  const scaled = raw.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + unit + '(?=\\s|$|[.,!?])'))
  const currency = raw.match(/(?:aed|درهم)\s*(\d+(?:\.\d+)?)/) ?? raw.match(/(\d+(?:\.\d+)?)\s*(?:aed|درهم)/)
  const plain = raw.match(/(?:max(?:imum)?|min(?:imum)?|under|below|above|budget|up to|at least|أقل من|اقل من|بحد أقصى|ميزانية|أكثر من|اكثر من)\s*(?:aed\s*)?(\d{4,}(?:\.\d+)?)/) ?? raw.match(/^(\d{4,}(?:\.\d+)?)$/)
  const value = scaled ? amount(scaled[1], scaled[2]) : currency ? Number(currency[1]) : plain ? Number(plain[1]) : undefined
  if (value === undefined || !Number.isFinite(value)) return {}
  return /\b(min|minimum|above|at least|from|starting)\b|أكثر من|اكثر من|على الأقل|حد أدنى/.test(raw) ? { minPrice: value } : { maxPrice: value }
}

export interface StructuredPropertyIntent {
  patch: Partial<PropertySearchCriteria>
  language: 'en' | 'ar'
  isProperty: boolean
  more: boolean
  reset: boolean
  mediaRequested: boolean
}

export class StructuredIntentClassifier {
  classify(message: string, existing: PropertySearchCriteria = { excludeRefs: [] }): StructuredPropertyIntent {
    const raw = normalizeStructuredText(message)
    const patch: Partial<PropertySearchCriteria> = { ...extractBudgetBounds(message) }
    // An identity token is never interpolated into a REST filter expression.
    const explicit = message.match(/(?:\b(?:ref(?:erence)?(?:\s*(?:number|no\.?))?|property\s+ref)\b|المرجع|مرجع|رقم العقار)\s*(?:[:#]\s*|\s+)(?:"([^"]+)"|'([^']+)'|([^\s,;!?]+))/i)
    const token = message.match(/(?:^|[\s(])([A-Za-z][A-Za-z0-9_/-]*[-_]\d[A-Za-z0-9_/-]*)(?=$|[\s),.!?])/)
    if (explicit || token) patch.referenceNumber = explicit ? explicit[1] ?? explicit[2] ?? explicit[3] : token![1]
    const area = Object.keys(AREA_ALIASES).sort((a, b) => b.length - a.length).find(alias => {
      const offset = raw.indexOf(alias)
      return offset >= 0 && !/[a-z]/.test(raw[offset - 1] ?? '') && !/[a-z]/.test(raw[offset + alias.length] ?? '')
    })
    if (area) patch.area = AREA_ALIASES[area]
    const bed = raw.match(/\b(\d+)\s*(?:br|bhk|beds?|bedrooms?)\b/) ?? raw.match(/(\d+)\s*(?:غرف|غرفة|غرف نوم)/)
    if (bed) patch.bedrooms = bed[1]
    else if (/غرفتين|غرفتان/.test(raw)) patch.bedrooms = '2'
    else if (/غرفة واحدة|غرفه واحده/.test(raw)) patch.bedrooms = '1'
    else if (/ثلاث غرف/.test(raw)) patch.bedrooms = '3'
    else if (/أربع غرف|اربع غرف/.test(raw)) patch.bedrooms = '4'
    if (/\bstudio\b|استوديو|ستوديو/.test(raw)) { patch.bedrooms = 'Studio'; patch.propertyType = 'apartment' }
    if (/\b(apartment|flat)\b|شقة|شقه/.test(raw)) patch.propertyType = 'apartment'
    if (/\bvilla\b|فيلا/.test(raw)) patch.propertyType = 'villa'
    if (/\btownhouse\b|تاون هاوس/.test(raw)) patch.propertyType = 'townhouse'
    if (/\bpenthouse\b|بنتهاوس/.test(raw)) patch.propertyType = 'penthouse'
    if (/\b(buy|buying|purchase|sale|invest)\b|شراء|للبيع|تملك/.test(raw)) patch.transactionType = 'SALE'
    else if (/\b(rent|rental|renting|lease)\b|إيجار|ايجار|للإيجار/.test(raw)) patch.transactionType = 'RENT'
    if (/\b(not|no|don't want)\s+(?:to\s+)?rent\b|ليس للإيجار/.test(raw)) patch.transactionType = 'SALE'
    if (/\b(not|no|don't want)\s+(?:to\s+)?buy\b|ليس للبيع/.test(raw)) patch.transactionType = 'RENT'
    if (/off[- ]?plan|على المخطط|قيد الإنشاء|قيد الانشاء/.test(raw)) patch.status = 'off-plan'
    else if (/\bready\b|جاهز|جاهزة/.test(raw)) patch.status = 'ready'
    if (/\bdistress\b|بيع اضطراري/.test(raw)) patch.distressOnly = true
    if (/\bno distress\b|بدون بيع اضطراري/.test(raw)) patch.distressOnly = false
    // Explicit labels preserve arbitrary project/building/developer names; no guessing from location.
    for (const [key, label] of [['area','area|منطقة'],['project', 'project|مشروع'], ['building', 'building|مبنى|برج'], ['developer', 'developer|المطور']] as const) {
      const match = message.match(new RegExp('(?:' + label + ')\\s*[:=]\\s*(?:"([^"]+)"|([^,;\\n]+))', 'i'))
      if (match) patch[key] = (match[1] ?? match[2]).trim()
    }
    const more = !/\bmore details\b|تفاصيل أكثر|تفاصيل اكثر/.test(raw) && /\b(more|another|alternatives?|other options?|similar|next listings?)\b|المزيد|خيارات أخرى|خيارات اخرى|بديل/.test(raw)
    const reset = /\b(start over|new search|reset search)\b|بحث جديد|ابدأ من جديد/.test(raw)
    const mediaRequested = /\b(photos?|images?|videos?|brochures?|floor[- ]?plans?|location pin)\b|صور|فيديو|مخطط|بروشور/.test(raw)
    const hasExisting = Object.keys(existing).some(key => key !== 'excludeRefs')
    const isProperty = Object.keys(patch).length > 0 || /\b(propert(?:y|ies)|listings?|apartments?|villas?|townhouses?|penthouses?)\b|عقار|شقق|فلل/.test(raw) || ((more || mediaRequested || reset || /\b(show|check|find|search)\b|ابحث|اعرض/.test(raw)) && hasExisting)
    return { patch, language: /[\u0600-\u06ff]/.test(message) ? 'ar' : 'en', isProperty, more, reset, mediaRequested }
  }

  merge(intent: StructuredPropertyIntent, existing: PropertySearchCriteria): PropertySearchCriteria {
    const base = intent.reset ? { excludeRefs: [] } : { ...existing }
    // A new structured search leaves the previous exact-reference context.
    if (!intent.patch.referenceNumber && Object.keys(intent.patch).length > 0) delete base.referenceNumber
    if(intent.more)delete base.referenceNumber
    return propertySearchCriteriaSchema.parse({ ...base, ...intent.patch, excludeRefs: base.excludeRefs })
  }
}
export const structuredIntentClassifier = new StructuredIntentClassifier()
export function extractStructuredCriteria(message: string, memory: Record<string, unknown>): PropertySearchCriteria {
  const existing = criteriaFromLegacy(memory)
  return structuredIntentClassifier.merge(structuredIntentClassifier.classify(message, existing), existing)
}
