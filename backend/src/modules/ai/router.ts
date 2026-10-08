import { queryProperties } from './handlers/propertyHandler.js'
import { extractStructuredCriteria } from './StructuredIntentClassifier.js'
import { formatVerifiedProperties } from '../../properties/PropertyMediaService.js'
import { createClient } from '@supabase/supabase-js'
import { getAgentResponse } from './handlers/agentHandler.js'
import type { ResolvedAgent } from './agentResolver.js'
import { getCompanyInfoAsString } from './handlers/companyHandler.js'
import { HybridRAG, type RetrievalTrace } from '../../rag/HybridRAG.js'

export type Lane = 'AGENT' | 'PROPERTY' | 'FAQ' | 'COMPANY' | 'GENERAL' | 'CHAT'

export interface Intent {
  area?: string
  bedrooms?: string
  maxPrice?: number
  minPrice?: number
  transactionType?: 'SALE' | 'RENT'
  category?: string
  agentNameHint?: string
  intent?: 'buy' | 'rent' | 'invest' | 'unknown'
}

export interface RouteResult {
  lane: Lane
  lang: 'en' | 'ar'
  intent: Intent
  directReply?: string
  properties?: Record<string, unknown>[]
  propertiesFound?: number
  noResultReason?: 'no_listings_in_area' | 'no_listings_match' | 'filtered_out' | 'db_error'
  faqContext?: string
  retrievalTrace?: RetrievalTrace
  handoff?: boolean
  isReturningUser?: boolean
  generalType?: 'answer' | 'smalltalk' | 'decline'
  resolvedAgent?: Pick<ResolvedAgent, 'id' | 'name' | 'phone'>
  shownPropertyRefs?: string[]
}

const faqRag = new HybridRAG()

const AREAS: Record<string, string> = {
  'burj khalifa': 'Burj Khalifa',
  'burja khalifa': 'Burj Khalifa',
  'burj kalifa': 'Burj Khalifa',
  'burj khalfa': 'Burj Khalifa',
  downtown: 'Downtown Dubai',
  'downtown dubai': 'Downtown Dubai',
  marina: 'Dubai Marina',
  'marina duabi': 'Dubai Marina',
  'marina dubai': 'Dubai Marina',
  'duabi marina': 'Dubai Marina',
  'dubai marina': 'Dubai Marina',
  jbr: 'Jumeirah Beach Residence',
  'jumeirah beach': 'Jumeirah Beach Residence',
  jvc: 'Jumeirah Village Circle',
  'jumeirah village circle': 'Jumeirah Village Circle',
  'jumeirah village': 'Jumeirah Village Circle',
  jlt: 'Jumeirah Lake Towers',
  'jumeirah lake towers': 'Jumeirah Lake Towers',
  jvt: 'Jumeirah Village Triangle',
  'jumeirah village triangle': 'Jumeirah Village Triangle',
  'business bay': 'Business Bay',
  difc: 'DIFC',
  palm: 'Palm Jumeirah',
  'palm jumeirah': 'Palm Jumeirah',
  'dubai media city': 'Dubai Media City',
  'media city': 'Dubai Media City',
  arjan: 'Arjan',
  'motor city': 'Motor City',
  dsc: 'Dubai Sports City',
  'dubai sports city': 'Dubai Sports City',
  'damac hills': 'DAMAC Hills',
  'damac hills 2': 'DAMAC Hills 2',
  akoya: 'DAMAC Hills 2',
  'damac lagoons': 'DAMAC Lagoons',
  majan: 'Majan',
  liwan: 'Liwan',
  'silicon oasis': 'Dubai Silicon Oasis',
  dso: 'Dubai Silicon Oasis',
  meydan: 'Meydan',
  'town square': 'Town Square',
  'al furjan': 'Al Furjan',
  'discovery gardens': 'Discovery Gardens',
  'international city': 'International City',
  'dubai islands': 'Dubai Islands',
  dlrc: 'Dubai Land Residence Complex',
  dubailand: 'Dubailand',
  'al zorah': 'Al Zorah',
  aljada: 'Aljada',
  'dubai hills': 'Dubai Hills Estate',
  creek: 'Dubai Creek Harbour',
  'creek harbour': 'Dubai Creek Harbour',
  'city walk': 'City Walk',
  bluewaters: 'Bluewaters Island',
  jumeirah: 'Jumeirah',
  'arabian ranches': 'Arabian Ranches',
  'arabian ranches 3': 'Arabian Ranches 3',
  'al wasl': 'Al Wasl',
}

function parseBudget(text: string): number | undefined {
  const t = text.replace(/,/g, '').replace(/aed/gi, '').trim()
  const million = t.match(/(\d+(?:\.\d+)?)\s*(?:m|million|mn|مليون)/i)
  if (million) return Math.round(parseFloat(million[1]) * 1_000_000)
  const thousand = t.match(/(\d+(?:\.\d+)?)\s*(?:k|thousand)/i)
  if (thousand) return Math.round(parseFloat(thousand[1]) * 1_000)
  const plain = t.match(/\b(\d{4,9})\b/)
  if (plain) return parseInt(plain[1], 10)
  return undefined
}

function detectArea(raw: string): string | undefined {
  for (const [alias, canonical] of Object.entries(AREAS)) {
    if (raw.includes(alias)) return canonical
  }
  return undefined
}

async function getFaqContext(question: string, orgId: string, allowedIds: string[] = [], version = '') {
  return faqRag.retrieve(question, orgId, version, allowedIds)
}

export async function routeMessage(params: {
  message: string
  orgId: string
  memory: Record<string, unknown>
  knowledgeBaseIds?: string[]
  agentVersionId?: string
}): Promise<RouteResult> {
  const { message, orgId, memory } = params
  const raw = message.toLowerCase().trim()
  const hasArabic = /[\u0600-\u06FF]/.test(message)
  const lang: 'en' | 'ar' = hasArabic ? 'ar' : 'en'

  const area = detectArea(raw) ?? (typeof memory.area === 'string' ? memory.area : undefined)
  const bedroomsMatch = raw.match(/\b(\d+)\s*(?:br|bed(?:room)?s?)\b/i) ?? raw.match(/\b(studio)\b/i)
  const budget = parseBudget(message)

  let maxPrice: number | undefined
  let minPrice: number | undefined
  if (/\b(max|maximum|under|below|up to|budget|أقصى|أقل|ميزانية)\b/i.test(raw)) maxPrice = budget
  else if (/\b(min|minimum|above|at least|from|starting|أكثر|فوق)\b/i.test(raw)) minPrice = budget
  else maxPrice = budget

  maxPrice ??= typeof memory.maxBudget === 'number' ? memory.maxBudget : undefined
  minPrice ??= typeof memory.minBudget === 'number' ? memory.minBudget : undefined

  const negatesRent =
    /\b(don'?t|not|no|without|exclude|stop showing|no more)\b.*\b(rent|rental|lease)\b/i.test(raw) ||
    /\b(rent|rental|lease)\b.*\b(only|just)\b.*\b(sale|buy|purchase)\b/i.test(raw)
  const negatesBuy =
    /\b(don'?t|not|no|without|exclude|stop showing|no more)\b.*\b(buy|sale|purchase|ownership)\b/i.test(raw)

  let transactionType: 'SALE' | 'RENT' | undefined
  if (/\b(buy|purchase|buying|bought|for sale|to buy|invest|ownership|تملك|للبيع|شراء)\b/i.test(raw)) {
    transactionType = 'SALE'
  } else if (/\b(rent|rental|renting|lease|leasing|للإيجار|إيجار|أجار)\b/i.test(raw)) {
    transactionType = 'RENT'
  }
  if (negatesRent) {
    transactionType = 'SALE'
    console.log('[ROUTER] Negation detected -> forcing SALE')
  }
  if (negatesBuy) {
    transactionType = 'RENT'
    console.log('[ROUTER] Negation detected -> forcing RENT')
  }
  if (!transactionType && maxPrice && maxPrice >= 200_000) transactionType = 'SALE'
  transactionType ??= memory.transactionType as 'SALE' | 'RENT' | undefined

  const category = raw.match(/\b(penthouse|villa|townhouse|apartment|studio|flat|duplex|office)\b/i)?.[1]?.toLowerCase()
  const agentNameHint: string | undefined = undefined

  const intent: Intent = {
    area,
    bedrooms: bedroomsMatch?.[1]?.toLowerCase() === 'studio' ? 'Studio' : bedroomsMatch?.[1],
    maxPrice,
    minPrice,
    transactionType,
    category,
    agentNameHint,
    intent: transactionType === 'SALE' ? 'buy' : transactionType === 'RENT' ? 'rent' : 'unknown',
  }

  const isFrustrated =
    /\b(useless|terrible|awful|disgusting|pathetic|worst|rubbish|scam|waste|fraudulent|fraud|cheating|lawsuit|legal action)\b/i.test(raw) ||
    /\b(speak to human|speak to agent|real person|talk to manager|call manager|your manager|i want a human|get me a human)\b/i.test(raw) ||
    /\b(انتهى صبري|عديم الفائدة|أريد موظف|تكلم إنسان|مدير|شكوى)\b/i.test(raw)

  if (isFrustrated) {
    const response = await getAgentResponse(orgId, lang, area, maxPrice)
    return {lane:'AGENT',lang,intent,directReply:response.content,handoff:true,resolvedAgent:response.agent??undefined}
  }

  const hasCompanyTerms =
    /\b(office|address|location|where is your office|where are you|website|email|phone|number|company|contact details|contact info|contact information|office address|office number|company website|company phone|company address|current locations?)\b/i.test(raw) ||
    /\b(send|share|give|provide)\b.*\b(address|location|office|website|email|phone|number|details|info)\b/i.test(raw) ||
    /\b(عنوان|موقع|مكتب|تفاصيل الشركة|معلومات الشركة|رقم الشركة|البريد الإلكتروني|الموقع الإلكتروني)\b/i.test(raw)

  const hasAgentTerms =
    /\b(agent|consultant|specialist|sales manager|ceo|broker|advisor|meet|meeting|appointment|human|person|contact agent|agent contact|agent number|whatsapp)\b/i.test(raw) ||
    /\b(وكيل|مستشار|موعد|رقم الوكيل|تواصل مع مستشار)\b/i.test(raw) ||
    Boolean(agentNameHint)

  if (hasCompanyTerms && hasAgentTerms) {
    console.log('[ROUTER] lane=COMPANY mixed_company_agent=true')
    return {
      lane: 'COMPANY',
      lang,
      intent,
      directReply: await getCompanyInfoAsString(orgId, lang, message),
    }
  }

  if (hasCompanyTerms) {
    console.log('[ROUTER] lane=COMPANY')
    return {
      lane: 'COMPANY',
      lang,
      intent,
      directReply: await getCompanyInfoAsString(orgId, lang, message),
    }
  }

  if (hasAgentTerms) {
    const response = await getAgentResponse(orgId, lang, area, maxPrice)
    return {lane:'AGENT',lang,intent,directReply:response.content,handoff:true,resolvedAgent:response.agent??undefined}
  }

  const isGreeting =
    raw.length < 40 &&
    /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|سلام|مرحبا|أهلا|هلا|هاي|مساء الخير|صباح الخير)\b/i.test(raw)

  const hasPropertyAction = /\b(show|find|search|available|list|check|display)\b/i.test(raw)
  const hasPropertyNoun = /\b(property|properties|apartment|villa|townhouse|penthouse|studio|flat|duplex|unit|listing)\b/i.test(raw)
  const hasPropertyTransaction = /\b(buy|rent|purchase|for sale|for rent|lease|للبيع|للإيجار|شراء|إيجار)\b/i.test(raw)
  const hasAreaOrPrice = Boolean(area) || Boolean(budget) || Boolean(bedroomsMatch)

  // STRICT: requires noun OR (action + area/price) OR transaction type
  const isPropertyLane =
    !isGreeting &&
    (
      hasPropertyNoun ||
      hasPropertyTransaction ||
      (hasPropertyAction && hasAreaOrPrice)
    )

  if (isPropertyLane) {
    const result=await queryProperties({orgId,...extractStructuredCriteria(message,memory)})
    return { lane:'PROPERTY',lang,intent,propertiesFound:result.properties?.length ?? 0,
      properties:result.properties,shownPropertyRefs:(result.properties ?? []).map(p=>String(p.ref_number || p.ref)),
      directReply:result.found?formatVerifiedProperties(result.properties ?? [],lang):result.message }
  }

  const isFAQLane =
    /\b(dld|dld fee|transfer fee|registration fee|mortgage|loan|finance|ltv|down payment|golden visa|investor visa|residency visa|roi|return on investment|rental yield|gross yield|net yield|ejari|dewa|utilities|service charge|maintenance fee|community fee|off.?plan|handover|payment plan|installment|oqood|title deed|freehold|leasehold|rera|dubai land department|best area|which area|recommend area)\b/i.test(raw) ||
    /\b(رهن|رسوم|تأشيرة ذهبية|عائد|استثمار|أفضل منطقة|خطة دفع)\b/i.test(raw)

  if (isFAQLane) {
    return {
      lane: 'FAQ',
      lang,
      intent,
      ...await (async()=>{const retrieval=await getFaqContext(message,orgId,params.knowledgeBaseIds,params.agentVersionId);return{faqContext:retrieval.context,retrievalTrace:retrieval.trace}})(),
    }
  }

  const wantsArabic =
    /\b(can you speak arabic|do you speak arabic|speak arabic|arabic please)\b/i.test(raw)
  if (wantsArabic) {
    return {
      lane: 'GENERAL',
      lang: 'ar',
      intent,
      directReply: 'نعم، يمكنني مساعدتك بالعربية والإنجليزية. كيف يمكنني مساعدتك اليوم؟',
      generalType: 'answer',
      isReturningUser: Object.keys(memory).length > 0,
    }
  }

  const isSmallTalk =
    /\b(how are you|you okay|you good|how's it going|tell me a joke|be funny|something funny|make me laugh)\b/i.test(raw)
  if (isSmallTalk) {
    return {
      lane: 'GENERAL',
      lang,
      intent,
      generalType: 'smalltalk',
      isReturningUser: Object.keys(memory).length > 0,
    }
  }

  const isDeclineGeneral =
    /\b(write (an )?essay|do my homework|complete my assignment|write code|build me malware|hack|medical diagnosis|legal advice)\b/i.test(raw)
  if (isDeclineGeneral) {
    return {
      lane: 'GENERAL',
      lang,
      intent,
      generalType: 'decline',
      isReturningUser: Object.keys(memory).length > 0,
    }
  }

  const isGeneralLane =
    /\b(what is|who is|when is|where is|why is|how does|difference between|versus|vs\b|weather|news|crypto|bitcoin|blockchain|stock|economy)\b/i.test(raw)

  if (isGeneralLane) {
    return {
      lane: 'GENERAL',
      lang,
      intent,
      generalType: 'answer',
      isReturningUser: Object.keys(memory).length > 0,
    }
  }

  return {
    lane: 'CHAT',
    lang,
    intent,
    isReturningUser: Object.keys(memory).length > 0,
  }
}
