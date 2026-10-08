import { executionTrace } from '../observability/ExecutionTraceService.js'
import { safeCriteria } from '../observability/TracePrivacy.js'
/**
 * INTENT-BASED ROUTING
 * 
 * This is the main routing layer that:
 * 1. Detects user intent (company, agent, property, faq, general)
 * 2. Routes to appropriate handler (no AI)
 * 3. Only calls AI for formatting/general responses
 * 
 * Flow:
 * Message → detectPrimaryIntent() → route to handler
 *
 * company → companyHandler (return static data)
 * agent → agentHandler (return agent contact)
 * property → propertyHandler (query DB, pass results to AI)
 * faq → router.ts (existing FAQ handler)
 * general → router.ts (existing general handler)
 */

import { getResolvedClientFacingTeam } from './agentResolver.js'
import { detectPrimaryIntent } from './intentDetector.js'
import { structuredIntentClassifier } from './StructuredIntentClassifier.js'
import { criteriaFromLegacy, normalizeArea, normalizeIdentity, type PropertySearchCriteria } from '../../properties/PropertySearchCriteria.js'
import { ConversationStateService } from '../contacts/ConversationStateService.js'
import { ConfigError } from '../config/AgentVersionService.js'
import type {AgentConfig} from '../config/AgentVersionService.js'
import {permitsTool} from '../config/AgentStudioPolicy.js'
import {
  getCompanyInfoAsString,
} from './handlers/companyHandler.js'
import {
  getAgentResponse,
  getAgentByName,
  type AgentResponse,
} from './handlers/agentHandler.js'
import { queryProperties, buildNoPropertiesMessage, type PropertyHandlerResponse } from './handlers/propertyHandler.js'

export interface RoutedMessageRequest {
  orgId: string
  contactId?: string
  conversationId?: string
  message: string
  phoneNumber: string
  memory: Record<string, unknown>
  propertyCriteria?: PropertySearchCriteria
  agentConfig?:AgentConfig|null
}

export interface DirectResponse {
  type: 'direct'
  content: string
  language: 'en' | 'ar'
  metadata?: Record<string, unknown>
}

export interface QueryResponse {
  type: 'query'
  data: PropertyHandlerResponse
  language: 'en' | 'ar'
}

export interface DeferToAIResponse {
  type: 'defer_to_ai'
  language: 'en' | 'ar'
  data?: unknown
}

export type RoutingResult = DirectResponse | QueryResponse | DeferToAIResponse

/**
 * Main routing function
 * Detects intent and routes to appropriate handler
 */
export async function routeByIntent(request: RoutedMessageRequest): Promise<RoutingResult> {
  const { orgId, contactId, conversationId, message, phoneNumber, memory } = request

  // Step 1: Detect intent using strict rules
  const detection = detectPrimaryIntent(message)
  const detectedLanguage = /[\u0600-\u06FF]/.test(message) ? 'ar' : 'en'
  const language=request.agentConfig&&!request.agentConfig.languages.includes(detectedLanguage)?request.agentConfig.identity.defaultLanguage??request.agentConfig.languages[0]:detectedLanguage
  const storedState = conversationId ? await new ConversationStateService().read(orgId,conversationId,contactId) : null
  const structured = structuredIntentClassifier.classify(message,storedState?.criteria ?? request.propertyCriteria ?? criteriaFromLegacy(memory))
  if (structured.isProperty && detection.intent !== 'company' && detection.intent !== 'agent' && detection.intent !== 'faq') detection.intent='property'

  executionTrace.patch({ language, intent: detection.intent, confidence: detection.confidence, routingReason: detection.reason, entities: safeCriteria(structured.patch), memoryBefore: safeCriteria(storedState?.criteria ?? memory), memoryAfter: safeCriteria(storedState?.criteria ?? memory) })

  // Step 2: Route by intent
  switch (detection.intent) {
    // COMPANY: Return static company info (never call AI)
    case 'company': {
      const content = await getCompanyInfoAsString(orgId, language, message)
      executionTrace.tool('company.read', {}, { outcome: 'authoritative_company_facts' })
      return {
        type: 'direct',
        content,
        language,
        metadata: {
          handoff: false,
          routing: 'company_handler',
        },
      }
    }

    // AGENT: Return agent contact (never call AI)
    case 'agent': {
      if(!permitsTool(request.agentConfig,'team.lookup'))return {type:'direct',language,content:language==='ar'?'يرجى التواصل مع فريق الشركة مباشرة.':'Please contact the company team directly.',metadata:{handoff:false}}
      const area = typeof memory.area === 'string' ? memory.area : undefined
      const maxPrice = typeof memory.maxBudget === 'number' ? memory.maxBudget : undefined
      const team=await getResolvedClientFacingTeam(orgId)
      const mentioned=team.filter(member=>message.normalize('NFKC').toLocaleLowerCase().includes(member.name.normalize('NFKC').toLocaleLowerCase()))
      const named=mentioned.length===1?await getAgentByName(orgId,mentioned[0].name,language):null
      const response: AgentResponse = named ?? await getAgentResponse(orgId, language, area, maxPrice)
      executionTrace.tool('team.lookup', { area, maxPrice }, { memberId: response.agent?.id ?? null })

      return {
        type: 'direct',
        content: response.content,
        language,
        metadata: {
          handoff: true,
          routing: 'agent_handler',
          agent: response.agent,
        },
      }
    }

    // PROPERTY: Query database, return results or defer to AI
    case 'property': {
      const service = conversationId ? new ConversationStateService() : null
      for (let attempt=0;attempt<4;attempt++) {
        const state = service && conversationId ? await service.read(orgId,conversationId,contactId) : null
        const existing = state?.criteria ?? request.propertyCriteria ?? criteriaFromLegacy(memory)
        const classified = structuredIntentClassifier.classify(message,existing)
        let criteria = structuredIntentClassifier.merge(classified,existing)
        const policy=request.agentConfig?.propertyPolicy
        if(policy?.excludePreviouslyShown===false)criteria.excludeRefs=[]
        if(!permitsTool(request.agentConfig,criteria.referenceNumber?'property.lookup':'property.search'))return {type:'direct',language,content:language==='ar'?'البحث عن العقارات غير مفعل لهذا المساعد.':'Property lookup is disabled for this assistant.',metadata:{handoff:false}}
        if(/\bcompare\b|قارن/i.test(message)&&!permitsTool(request.agentConfig,'property.compare'))return {type:'direct',language,content:language==='ar'?'المقارنة غير مفعلة لهذا المساعد.':'Property comparison is disabled for this assistant.',metadata:{handoff:false}}
        // A media follow-up reuses the current listing rather than silently selecting another.
        if (classified.mediaRequested && !Object.keys(classified.patch).length && !criteria.referenceNumber && state?.shownRefs.length) criteria={ ...criteria,referenceNumber:state.shownRefs.at(-1) }
        const response: PropertyHandlerResponse = !criteria.referenceNumber && !criteria.area && !criteria.project && !criteria.building && !criteria.developer && !criteria.distressOnly && (policy?.clarificationRules!=='any-constraint'||!Object.keys(criteria).some(k=>k!=='excludeRefs'))
          ? { found:false,message:language==='ar'?'يرجى تحديد منطقة أو مشروع أو مرجع للعقار.':'Please specify an area, project, building or property reference.',noResultReason:'missing_location',criteria,trace:['clarification'] }
          : await queryProperties({ orgId,contactId:state?.contactId ?? contactId,conversationId,...criteria,mediaRequested:classified.mediaRequested&&permitsTool(request.agentConfig,'property.send_media'),maxResults:policy?.maxResults,relaxationPolicy:policy?{...policy,approved:policy.priceRelaxationPercent>0,maxPricePercent:policy.priceRelaxationPercent}:undefined })
        executionTrace.tool(criteria.referenceNumber ? 'property.lookup' : 'property.search', safeCriteria(criteria), { ids: (response.properties ?? []).map(p=>p.id), count: response.count ?? 0, reason: response.noResultReason ?? null, source: response.source, matchQuality: response.matchQuality, relaxedFields: response.relaxedFields, gates: response.trace })
        executionTrace.patch({ propertyQuery: safeCriteria(criteria), propertyIds: (response.properties ?? []).map(p=>p.id), matchQuality: response.matchQuality, propertyReason: response.noResultReason ?? null })
        if (classified.mediaRequested) executionTrace.tool('property.send_media', { allowed: permitsTool(request.agentConfig, 'property.send_media') }, { outcome: 'verified_media_in_response' })
        if (!response.found && response.noResultReason !== 'missing_location') response.message=buildNoPropertiesMessage(language,criteria.area,response.noResultReason)
        if (state && service && response.noResultReason !== 'db_error') {
          // Exact identity stays selected for detail/media requests. Its recorded facts
          // provide context when the user explicitly asks for other options next.
          const selected=criteria.referenceNumber?response.properties?.[0]:undefined
          if(selected){
            if(criteria.area===undefined && typeof selected.district==='string')criteria.area=normalizeArea(selected.district)
            if(criteria.bedrooms===undefined && typeof selected.bedrooms==='string')criteria.bedrooms=selected.bedrooms
            if(criteria.propertyType===undefined && ['apartment','villa','townhouse','penthouse'].includes(String(selected.type)))criteria.propertyType=selected.type as PropertySearchCriteria['propertyType']
            if(criteria.transactionType===undefined && ['SALE','RENT'].includes(String(selected.transaction_type)))criteria.transactionType=selected.transaction_type as PropertySearchCriteria['transactionType']
          }
          const refs=(response.properties ?? []).flatMap(p=>[p.ref,p.ref_number]).filter((r):r is string=>typeof r==='string' && !!r.trim())
          const previous=classified.reset?[]:state.shownRefs
          const shown=[...new Map([...previous,...refs].map(ref=>[normalizeIdentity(ref),ref])).values()]
          criteria.excludeRefs=shown
          try { await service.save(orgId,state,criteria,shown,language) }
          catch (error) { if (error instanceof ConfigError && error.status===409 && attempt<3) continue; throw error }
        }
        executionTrace.patch({ memoryAfter: safeCriteria(criteria) })
        return { type:'query',data:response,language }
      }
      throw new ConfigError(409,'STATE_CONFLICT','Conversation is busy. Please retry.')
    }

    // FAQ & GENERAL: Defer to existing router.ts
    default: {
      return {
        type: 'defer_to_ai',
        language,
      }
    }
  }
}
