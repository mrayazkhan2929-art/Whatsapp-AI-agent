import { getSupabaseAdmin, isSupabaseConfigured } from '../config/supabase.js'
import { normalizeArea, normalizeIdentity, propertySearchCriteriaSchema, type PropertySearchCriteria } from './PropertySearchCriteria.js'
import { structuredIntentClassifier, extractBudgetBounds } from '../modules/ai/StructuredIntentClassifier.js'
import { formatVerifiedProperties } from './PropertyMediaService.js'

export interface PropertyQuery {
  orgId: string
  category?: 'sale' | 'rent'
  area?: string
  bedrooms?: string
  minPrice?: number
  maxPrice?: number
  status?: 'ready' | 'off-plan'
  type?: 'apartment' | 'villa' | 'townhouse' | 'penthouse'
  transactionType?: 'SALE' | 'RENT'
  source?: 'direct' | 'indirect'
  distressDeal?: boolean
  limit?: number
}

export interface PropertyMatch {
  ref: string
  ref_number?: string | null
  type: 'apartment' | 'villa' | 'townhouse' | 'penthouse' | null
  transaction_type?: 'SALE' | 'RENT' | null
  category: 'sale' | 'rent' | null
  bedrooms: string | null
  bathrooms?: string | null
  size_sqft: number | null
  status: 'ready' | 'off-plan' | null
  district: string
  building: string | null
  price_aed: number
  agent_id: string | null
  agent_name?: string | null
  agent_whatsapp?: string | null
  available: boolean | null
  description?: string | null
  source?: 'direct' | 'indirect' | null
  partner_agency?: string | null
  partner_agent_name?: string | null
  partner_agent_phone?: string | null
  partner_agent_email?: string | null
  co_broker_commission?: number | null
  listing_url?: string | null
  distress_deal?: boolean | null
}

export interface DualSourceResult {
  properties: PropertyMatch[]
  source: 'direct' | 'indirect' | 'none'
  directCount: number
  indirectCount: number
  usedFallback: boolean
}

export interface PropertySearchIntent {
  area?: string
  bedrooms?: string
  type?: PropertyQuery['type']
  category?: PropertyQuery['category']
  status?: PropertyQuery['status']
  minPrice?: number
  maxPrice?: number
  agentMeeting?: boolean
  callRequested?: boolean
}

interface CachedPropertySet {
  fetchedAt: number
  items: PropertyMatch[]
}

const PROPERTY_CACHE_TTL_MS = 15 * 60 * 1000

const AREA_ALIASES: Record<string, string> = {
  jvc: 'JVC',
  'jumeirah village circle': 'JVC',
  jlt: 'JLT',
  'jumeirah lake towers': 'JLT',
  jvt: 'JVT',
  'dubai marina': 'Dubai Marina',
  marina: 'Dubai Marina',
  downtown: 'Downtown Dubai',
  'downtown dubai': 'Downtown Dubai',
  'business bay': 'Business Bay',
  bb: 'Business Bay',
  arjan: 'Arjan',
  'motor city': 'Motor City',
  'dubai sports city': 'Dubai Sports City',
  dsc: 'Dubai Sports City',
  majan: 'Majan',
  dlrc: 'Dubai Land Residence Complex',
  'dubai land residence complex': 'Dubai Land Residence Complex',
  'al zorah': 'Al Zorah',
}

// Retained for rollback/compatibility validation. Production callers use the canonical subclass below.
export class LegacyPropertyMatcher {
  private readonly supabase = isSupabaseConfigured() ? getSupabaseAdmin() : null
  private static readonly propertyCache = new Map<string, CachedPropertySet>()
  private static refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.ensureRefreshLoop()
  }

  private parseBedroomNumber(value?: string | null): number | null {
    if (!value) return null
    const lower = value.toLowerCase().trim()
    if (lower.includes('studio')) return 0
    const match = lower.match(/(\d+)/)
    if (!match) return null
    const num = Number(match[1])
    return Number.isNaN(num) ? null : num
  }

  private filterProperties(properties: PropertyMatch[], query: PropertyQuery): PropertyMatch[] {
    const normalizedArea = query.area ? this.normalizeArea(query.area).toLowerCase() : null
    const bedroomFilter = query.bedrooms?.toLowerCase().trim()
    const requestedBedroomNum = this.parseBedroomNumber(query.bedrooms)
    const sourceFilter = query.source ?? 'direct'

    return properties.filter((property) => {
      if (!property.available) {
        return false
      }

      if (sourceFilter && property.source !== sourceFilter) {
        return false
      }

      if (query.distressDeal === true && property.distress_deal !== true) {
        return false
      }

      if (query.category && property.category !== query.category) {
        return false
      }

      if (query.transactionType && property.transaction_type !== query.transactionType) {
        return false
      }

      if (query.type && property.type !== query.type) {
        return false
      }

      if (query.status && property.status !== query.status) {
        return false
      }

      if (bedroomFilter) {
        const propertyBedroomNum = this.parseBedroomNumber(property.bedrooms)
        if (requestedBedroomNum !== null && propertyBedroomNum !== null) {
          if (requestedBedroomNum !== propertyBedroomNum) return false
        } else if ((property.bedrooms ?? '').toLowerCase().trim() !== bedroomFilter) {
          return false
        }
      }

      // ── BUDGET FILTERS — CRITICAL FIX ──
      // ALWAYS apply budget filter when provided. Do NOT skip if value is 0 or falsy.
      if (query.maxPrice !== undefined && query.maxPrice > 0) {
        if (property.price_aed > query.maxPrice) {
          return false
        }
      }
      if (query.minPrice !== undefined && query.minPrice > 0) {
        if (property.price_aed < query.minPrice) {
          return false
        }
      }

      if (normalizedArea) {
        const district = property.district?.toLowerCase?.() ?? ''
        const building = (property.building ?? '').toLowerCase()
        if (!district.includes(normalizedArea) && !building.includes(normalizedArea)) {
          return false
        }
      }

      return true
    })
  }

  async search(query: PropertyQuery): Promise<PropertyMatch[]> {
    if (!this.supabase) {
      return []
    }

    const cachedProperties = await this.getCachedProperties(query.orgId)
    const filtered = this.filterProperties(cachedProperties, query)
    const maxResults = Math.min(query.limit ?? 3, 3)
    return filtered.slice(0, maxResults)
  }

  async searchWaterfall(query: PropertyQuery): Promise<DualSourceResult> {
    if (!this.supabase) {
      return {
        properties: [],
        source: 'none',
        directCount: 0,
        indirectCount: 0,
        usedFallback: false,
      }
    }

    const directQuery: PropertyQuery = {
      orgId: query.orgId,
      category: query.category,
      area: query.area,
      bedrooms: query.bedrooms,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      status: query.status,
      type: query.type,
      transactionType: query.transactionType,
      source: 'direct' as const,
      distressDeal: query.distressDeal,
      limit: query.limit ?? 3,
    }
    const directResults = await this.search(directQuery)
    const directCountQuery: PropertyQuery = {
      orgId: query.orgId,
      category: query.category,
      area: query.area,
      bedrooms: query.bedrooms,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      status: query.status,
      type: query.type,
      transactionType: query.transactionType,
      source: 'direct' as const,
      distressDeal: query.distressDeal,
      limit: undefined,
    }
    const directCount = (await this.countMatches(directCountQuery))

    if (directCount > 0) {
      return {
        properties: directResults.slice(0, query.limit ?? 3),
        source: 'direct',
        directCount,
        indirectCount: 0,
        usedFallback: false,
      }
    }

    const indirectQuery: PropertyQuery = {
      orgId: query.orgId,
      category: query.category,
      area: query.area,
      bedrooms: query.bedrooms,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      status: query.status,
      type: query.type,
      transactionType: query.transactionType,
      source: 'indirect' as const,
      distressDeal: query.distressDeal,
      limit: query.limit ?? 3,
    }
    const indirectResults = await this.search(indirectQuery)
    const indirectCountQuery: PropertyQuery = {
      orgId: query.orgId,
      category: query.category,
      area: query.area,
      bedrooms: query.bedrooms,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      status: query.status,
      type: query.type,
      transactionType: query.transactionType,
      source: 'indirect' as const,
      distressDeal: query.distressDeal,
      limit: undefined,
    }
    const indirectCount = (await this.countMatches(indirectCountQuery))

    return {
      properties: indirectResults.slice(0, query.limit ?? 3),
      source: indirectResults.length > 0 ? 'indirect' : 'none',
      directCount: 0,
      indirectCount,
      usedFallback: indirectResults.length > 0,
    }
  }

  private async countMatches(query: PropertyQuery): Promise<number> {
    const cachedProperties = await this.getCachedProperties(query.orgId)
    return this.filterProperties(cachedProperties, query).length
  }

  async logInventoryGap(params: {
    orgId: string
    contactId?: string
    conversationId?: string
    query: PropertyQuery
    directCount: number
    indirectCount: number
    usedFallback: boolean
  }): Promise<void> {
    if (params.directCount > 0) {
      return
    }

    try {
      await this.supabase?.from('inventory_gaps').insert({
        org_id: params.orgId,
        contact_id: params.contactId ?? null,
        conversation_id: params.conversationId ?? null,
        transaction_type: params.query.transactionType ?? null,
        area: params.query.area ?? null,
        bedrooms: params.query.bedrooms ?? null,
        budget_min: params.query.minPrice ?? null,
        budget_max: params.query.maxPrice ?? null,
        status_wanted: params.query.status ?? null,
        category: params.query.category ?? null,
        direct_results: params.directCount,
        indirect_results: params.indirectCount,
        used_fallback: params.usedFallback,
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      console.warn('Failed to log inventory gap', err)
    }
  }

  parseBudget(text: string): { min?: number; max?: number } {
    const normalizedText = text.toLowerCase().replace(/,/g, '').trim()
    const rangeMatch = normalizedText.match(
      /(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(m|million|k|thousand)?/,
    )
    if (rangeMatch) {
      return {
        min: this.convertBudgetValue(rangeMatch[1], rangeMatch[2]),
        max: this.convertBudgetValue(rangeMatch[3], rangeMatch[4]),
      }
    }

    const aedMatch = normalizedText.match(/aed\s*(\d+(?:\.\d+)?)(m|million|k|thousand)?/)
    if (aedMatch) {
      const amount = this.convertBudgetValue(aedMatch[1], aedMatch[2])
      return { min: amount * 0.85, max: amount * 1.15 }
    }

    const amountMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*(m|million|k|thousand)/)
    if (amountMatch) {
      const amount = this.convertBudgetValue(amountMatch[1], amountMatch[2])
      return { min: amount * 0.85, max: amount * 1.15 }
    }

    const plainNumber = normalizedText.match(/\b(\d{5,})\b/)
    if (plainNumber) {
      const amount = Number(plainNumber[1])
      return { min: amount * 0.85, max: amount * 1.15 }
    }

    return {}
  }

  extractIntent(text: string): PropertySearchIntent {
    const lowerText = text.toLowerCase()
    const budget = this.parseBudget(text)

    const area = Object.keys(AREA_ALIASES).find((alias) => lowerText.includes(alias))
    const bedroomMatch = lowerText.match(/\b(studio|[1-7])\s*(?:bed|bedroom|br)?\b/)
    const type = ['apartment', 'villa', 'townhouse', 'penthouse'].find((propertyType) =>
      lowerText.includes(propertyType),
    ) as PropertyQuery['type'] | undefined

    // Detect agent meeting intent
    const agentMeetingKeywords = [
      'meet agent', 'talk to agent', 'call me', 'visit office',
      'speak to agent', 'connect me', 'arrange meeting',
      'schedule meeting', 'book appointment', 'see agent',
      'contact agent', 'agent meeting', 'meet with agent',
      'want to meet', 'would like to meet', 'i need meeting',
      'i want agent', 'need agent', 'want agent',
      'call agent', 'get agent', 'contact specialist',
      'meet specialist', 'speak to specialist',
    ]

    const agentMeeting = agentMeetingKeywords.some(keyword => lowerText.includes(keyword))
    const callRequested = ['call me', 'call now', 'give me a call', 'phone me', 'ring me', 'contact me by phone'].some((keyword) => lowerText.includes(keyword))

    return {
      area: area ? AREA_ALIASES[area] : undefined,
      bedrooms: bedroomMatch ? bedroomMatch[1] : undefined,
      type,
      category: lowerText.includes('rent') ? 'rent' : lowerText.includes('buy') || lowerText.includes('sale') ? 'sale' : undefined,
      status: lowerText.includes('off-plan') ? 'off-plan' : lowerText.includes('ready') ? 'ready' : undefined,
      minPrice: budget.min,
      maxPrice: budget.max,
      agentMeeting,
      callRequested,
    }
  }

  isStrongIntent(text: string, memory?: Record<string, unknown>): boolean {
    const lowerText = text.toLowerCase()

    // Strong keywords that indicate explicit property search intent
    const strongKeywords = [
      "show", "looking for", "find", "search", "apartment", "villa", "studio",
      "bedroom", "buy", "rent", "properties", "property", "listings", "options",
      "available", "for sale", "for rent", "2 bedroom", "3 bedroom", "1 bedroom"
    ]

    const hasKeyword = strongKeywords.some(keyword => lowerText.includes(keyword))

    // Check if user has previously confirmed intent in memory
    const memoryIntent = memory?.intent as string
    const hasConfirmedIntent = memoryIntent === "buy" || memoryIntent === "rent" || memoryIntent === "invest"

    return hasKeyword || hasConfirmedIntent
  }

  formatCards(properties: PropertyMatch[], language: 'en' | 'ar' = 'en'): string {
    if (properties.length === 0) {
      return language === 'ar'
        ? 'لم أجد تطابقًا دقيقًا الآن. يمكنني توصيلك بأحد مستشاري العقارات لمراجعة الخيارات المتاحة.'
        : 'I could not find an exact match right now. I can connect you with one of our consultants to check more live options.'
    }

    const isIndirect = properties[0].source === 'indirect'
    const header = isIndirect
      ? language === 'ar'
        ? '🔍 *عقارات شركاء السوق* — لم نجد تطابقًا مباشرًا في محفظتنا:\n\n'
        : '🔍 *Partner market listings* — no exact matches in our direct portfolio:\n\n'
      : ''

    const divider = '\n\n----------------\n\n'
    const formatter = language === 'ar' ? this.formatArabicProperty.bind(this) : this.formatEnglishProperty.bind(this)
    return header + properties.slice(0, 3).map(formatter).join(divider)
  }

  // Backward-compatible alias used by older callers.
  formatCarousel(properties: PropertyMatch[], language: 'en' | 'ar' = 'en'): string {
    return this.formatCards(properties, language)
  }

  normalizeArea(input: string): string {
    return AREA_ALIASES[input.toLowerCase().trim()] ?? input.trim()
  }

  private async getCachedProperties(orgId: string): Promise<PropertyMatch[]> {
    const existing = LegacyPropertyMatcher.propertyCache.get(orgId)
    const isFresh = existing && Date.now() - existing.fetchedAt < PROPERTY_CACHE_TTL_MS
    if (isFresh) {
      return existing.items
    }

    await this.refreshOrgCache(orgId)
    return LegacyPropertyMatcher.propertyCache.get(orgId)?.items ?? []
  }

  private async refreshOrgCache(orgId: string): Promise<void> {
    if (!this.supabase) {
      return
    }

    const { data, error } = await this.supabase
      .from('properties')
      .select(
        'ref, ref_number, type, category, bedrooms, bathrooms, size_sqft, status, district, building, price_aed, agent_id, agent_name, agent_whatsapp, available, description, source, partner_agency, partner_agent_name, partner_agent_phone, partner_agent_email, co_broker_commission, listing_url, distress_deal',
      )
      .eq('org_id', orgId)
      .eq('available', true)
      .order('price_aed', { ascending: true })

    if (error) {
      return
    }

    const normalized = (data ?? []).map((property) => ({
      ...property,
      price_aed: Number(property.price_aed),
      size_sqft: property.size_sqft === null ? null : Number(property.size_sqft),
    }))

    LegacyPropertyMatcher.propertyCache.set(orgId, {
      fetchedAt: Date.now(),
      items: normalized,
    })
  }

  private ensureRefreshLoop(): void {
    if (LegacyPropertyMatcher.refreshTimer || !this.supabase) {
      return
    }

    LegacyPropertyMatcher.refreshTimer = setInterval(() => {
      const orgIds = Array.from(LegacyPropertyMatcher.propertyCache.keys())
      orgIds.forEach((orgId) => {
        void this.refreshOrgCache(orgId).catch(() => undefined)
      })
    }, PROPERTY_CACHE_TTL_MS)

    if (typeof LegacyPropertyMatcher.refreshTimer.unref === 'function') {
      LegacyPropertyMatcher.refreshTimer.unref()
    }
  }

  private convertBudgetValue(rawValue: string, rawUnit?: string): number {
    const value = Number(rawValue)
    const unit = rawUnit?.toLowerCase()

    if (unit === 'm' || unit === 'million') {
      return value * 1_000_000
    }

    if (unit === 'k' || unit === 'thousand') {
      return value * 1_000
    }

    return value
  }

  private formatEnglishProperty(property: PropertyMatch, index: number): string {
    const bedrooms = property.bedrooms ? `${property.bedrooms} BR` : 'N/A'
    const size = property.size_sqft ? `${property.size_sqft.toLocaleString()} sqft` : 'Size on request'
    const partnerLine = property.source === 'indirect'
      ? `Partner: ${property.partner_agency ?? 'Partner agency'} — our team will coordinate the viewing`
      : `Agent: ${property.agent_name ?? 'IERE Team'}`
    return [
      `*Property ${index + 1}*${property.source === 'indirect' ? ' 🤝 Partner listing' : ''}`,
      `${property.district}${property.building ? `, ${property.building}` : ''}`,
      `${bedrooms} | ${size}`,
      `AED ${property.price_aed.toLocaleString()}`,
      `Status: ${property.status ?? 'team-check required'}`,
      `Ref: ${property.ref}`,
      partnerLine,
    ].join('\n')
  }

  private formatArabicProperty(property: PropertyMatch, index: number): string {
    const bedrooms = property.bedrooms ? `${property.bedrooms} غرفة` : 'عدد الغرف عند الطلب'
    const size = property.size_sqft ? `${property.size_sqft.toLocaleString()} قدم مربع` : 'المساحة عند الطلب'
    return [
      `*العقار ${index + 1}*`,
      `${property.district}${property.building ? `، ${property.building}` : ''}`,
      `${bedrooms} | ${size}`,
      `ابتداءً من AED ${property.price_aed.toLocaleString()}`,
      `الحالة: ${property.status ?? 'بحاجة لتأكيد الفريق'}`,
      `المرجع: ${property.ref}`,
    ].join('\n')
  }
}

export interface CanonicalPropertyMatch extends PropertyMatch {
  id: string
  org_id: string
  project: string | null
  developer: string | null
  image_urls: string[]
}
export interface PropertyRelaxationPolicy { approved: boolean; maxPricePercent: number; directInventory?:boolean;indirectInventory?:boolean;distressDeals?:'include'|'exclude'|'only';fuzzyMatching?:boolean;minimumMatchScore?:number;areaAlternatives?:string[] }
export function propertyTextScore(left:string,right:string){const a=normalizeIdentity(left),b=normalizeIdentity(right);if(a===b)return 1;if(!a||!b||a.length>200||b.length>200)return 0;let previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));previous=next}return 1-previous[b.length]/Math.max(a.length,b.length)}
export interface CanonicalSearchResult extends DualSourceResult {
  properties: CanonicalPropertyMatch[]
  matchQuality: 'exact' | 'partial' | 'none'
  reason?: 'ambiguous_reference' | 'reference_not_found' | 'reference_unavailable' | 'constraints_not_matched'
  trace: string[]
  relaxedFields: string[]
}

export class PropertyMatcher extends LegacyPropertyMatcher {
  private readonly canonicalDb = isSupabaseConfigured() ? getSupabaseAdmin() : null

  override async logInventoryGap(params:Parameters<LegacyPropertyMatcher['logInventoryGap']>[0]):Promise<void>{
    if(!this.canonicalDb)throw new Error('Property database is unavailable')
    if(params.contactId){
      const contact=await this.canonicalDb.from('contacts').select('id').eq('org_id',params.orgId).eq('id',params.contactId).maybeSingle()
      if(contact.error || !contact.data)throw new Error('Inventory gap contact was not found')
    }
    if(params.conversationId){
      const parent=await this.canonicalDb.from('conversations').select('contact_id').eq('org_id',params.orgId).eq('id',params.conversationId).maybeSingle()
      if(parent.error || !parent.data || (params.contactId && parent.data.contact_id!==params.contactId))throw new Error('Inventory gap conversation was not found')
      const contact=await this.canonicalDb.from('contacts').select('id').eq('org_id',params.orgId).eq('id',parent.data.contact_id).maybeSingle()
      if(contact.error || !contact.data)throw new Error('Inventory gap parent was not found')
    }
    await super.logInventoryGap(params)
  }

  // No process cache: availability/price changes must be visible on the next request.
  async inventory(orgId: string): Promise<CanonicalPropertyMatch[]> {
    if (!this.canonicalDb) throw new Error('Property database is unavailable')
    const rows: CanonicalPropertyMatch[] = []
    for (let offset=0;;offset+=1000) {
      const result = await this.canonicalDb.from('properties').select('*').eq('org_id',orgId).order('id').range(offset,offset+999)
      if (result.error) throw new Error('Property lookup failed')
      const page = (result.data ?? []).filter(p => p.org_id === orgId).map(p => ({ ...p, price_aed:Number(p.price_aed), size_sqft:p.size_sqft === null ? null : Number(p.size_sqft) })) as CanonicalPropertyMatch[]
      rows.push(...page)
      if ((result.data ?? []).length < 1000) break
    }
    return rows
  }

  private matches(property: CanonicalPropertyMatch, criteria: PropertySearchCriteria): boolean {
    const same = (stored: string | null | undefined, requested?: string) => requested === undefined || (stored != null && normalizeIdentity(stored) === normalizeIdentity(requested))
    const beds = (value: string) => /studio|استوديو/i.test(value) ? '0' : value.match(/\d+/)?.[0] ?? normalizeIdentity(value)
    return property.available === true
      && same(property.transaction_type,criteria.transactionType)
      && same(property.type,criteria.propertyType) && same(property.project,criteria.project)
      && same(property.building,criteria.building) && same(property.developer,criteria.developer)
      && same(property.status,criteria.status)
      && (criteria.area === undefined || normalizeIdentity(normalizeArea(property.district)) === normalizeIdentity(normalizeArea(criteria.area)))
      && (criteria.bedrooms === undefined || (property.bedrooms !== null && beds(property.bedrooms) === beds(criteria.bedrooms)))
      && (criteria.minPrice === undefined || property.price_aed >= criteria.minPrice)
      && (criteria.maxPrice === undefined || property.price_aed <= criteria.maxPrice)
      && (!criteria.distressOnly || property.distress_deal === true)
  }

  async searchCanonical(orgId: string, input: PropertySearchCriteria, limit=3, policy?: PropertyRelaxationPolicy): Promise<CanonicalSearchResult> {
    const criteria = propertySearchCriteriaSchema.parse(input), rawInventory = await this.inventory(orgId)
    const inventory=rawInventory.filter(p=>(p.source==='indirect'?policy?.indirectInventory!==false:policy?.directInventory!==false)&&(policy?.distressDeals!=='exclude'||p.distress_deal!==true)&&(policy?.distressDeals!=='only'||p.distress_deal===true))
    const trace: string[] = [], empty = (reason: CanonicalSearchResult['reason']): CanonicalSearchResult => ({ properties:[],source:'none',directCount:0,indirectCount:0,usedFallback:false,matchQuality:'none',reason,trace,relaxedFields:[] })
    if (criteria.referenceNumber) {
      trace.push('exact_reference')
      const identity = normalizeIdentity(criteria.referenceNumber)
      const exact = inventory.filter(p => [p.ref,p.ref_number].some(ref => ref && normalizeIdentity(ref) === identity))
      if (exact.length !== 1) return empty(exact.length > 1 ? 'ambiguous_reference' : 'reference_not_found')
      if (!exact[0].available) return empty('reference_unavailable')
      const p = exact[0], indirect = p.source === 'indirect'
      return { properties:[p],source:indirect?'indirect':'direct',directCount:indirect?0:1,indirectCount:indirect?1:0,usedFallback:indirect,matchQuality:'exact',trace,relaxedFields:[] }
    }
    if (criteria.project || criteria.building) trace.push('exact_project_building')
    trace.push('exact_structured_constraints')
    // Exclude all aliases BEFORE ranking and limiting, including the partner fallback.
    const excluded = new Set(criteria.excludeRefs.map(normalizeIdentity))
    const eligible = inventory.filter(p => ![p.ref,p.ref_number].some(ref => ref && excluded.has(normalizeIdentity(ref))))
    let matches = eligible.filter(p => this.matches(p,criteria)), matchQuality: CanonicalSearchResult['matchQuality'] = 'exact'
    trace.push('ranked_structured_alternatives')
    const relaxedFields: string[] = []
    if(!matches.length&&criteria.area&&policy?.fuzzyMatching){matches=eligible.filter(p=>this.matches(p,{...criteria,area:undefined})&&propertyTextScore(normalizeArea(p.district),normalizeArea(criteria.area!))>=Math.max(0.7,policy.minimumMatchScore??0.85));if(matches.length){matchQuality='partial';relaxedFields.push('area spelling');trace.push('policy_approved_fuzzy_area')}}
    if(!matches.length&&criteria.area&&policy?.areaAlternatives?.length){matches=eligible.filter(p=>policy.areaAlternatives!.some(area=>this.matches(p,{...criteria,area})));if(matches.length){matchQuality='partial';relaxedFields.push('area');trace.push('policy_approved_area_alternatives')}}
    if (!matches.length && policy?.approved && Number.isFinite(policy.maxPricePercent) && policy.maxPricePercent > 0 && policy.maxPricePercent <= 10 && criteria.maxPrice !== undefined) {
      trace.push('policy_approved_budget_relaxation')
      matches = eligible.filter(p => this.matches(p,{ ...criteria,maxPrice:criteria.maxPrice!*(1+policy.maxPricePercent/100) }))
      if (matches.length) { matchQuality='partial'; relaxedFields.push('maxPrice') }
    }
    if (!matches.length) { trace.push('honest_no_match'); return empty('constraints_not_matched') }
    matches.sort((a,b) => Number(a.source === 'indirect')-Number(b.source === 'indirect') || a.price_aed-b.price_aed || a.ref.localeCompare(b.ref))
    const direct = matches.filter(p => p.source !== 'indirect'), indirect = matches.filter(p => p.source === 'indirect')
    const chosen = direct.length ? direct : indirect
    return { properties:chosen.slice(0,Math.max(1,Math.min(limit,20))),source:direct.length?'direct':'indirect',directCount:direct.length,indirectCount:indirect.length,usedFallback:!direct.length,matchQuality,trace,relaxedFields }
  }

  override normalizeArea(input: string): string { return normalizeArea(input) }
  override formatCards(properties:PropertyMatch[],language:'en'|'ar'='en'):string { return formatVerifiedProperties(properties as unknown as Record<string,unknown>[],language) }
  override formatCarousel(properties:PropertyMatch[],language:'en'|'ar'='en'):string { return this.formatCards(properties,language) }
  override parseBudget(text: string): { min?: number; max?: number } { const bounds=extractBudgetBounds(text); return { min:bounds.minPrice,max:bounds.maxPrice } }
  override extractIntent(text: string): PropertySearchIntent {
    const c=structuredIntentClassifier.classify(text).patch
    return { ...super.extractIntent(text),area:c.area,bedrooms:c.bedrooms,type:c.propertyType,category:c.transactionType === 'RENT'?'rent':c.transactionType === 'SALE'?'sale':undefined,status:c.status,minPrice:c.minPrice,maxPrice:c.maxPrice }
  }
  override async searchWaterfall(query: PropertyQuery): Promise<CanonicalSearchResult> {
    return this.searchCanonical(query.orgId,{ area:query.area,bedrooms:query.bedrooms,minPrice:query.minPrice,maxPrice:query.maxPrice,
      transactionType:query.transactionType ?? (query.category==='sale'?'SALE':query.category==='rent'?'RENT':undefined),propertyType:query.type,status:query.status,distressOnly:query.distressDeal,excludeRefs:[] },query.limit)
  }
  override async search(query: PropertyQuery): Promise<PropertyMatch[]> {
    const rows = (await this.searchWaterfall(query)).properties
    return query.source ? rows.filter(p => (p.source ?? 'direct')===query.source) : rows
  }
}
