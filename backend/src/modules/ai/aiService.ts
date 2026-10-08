import { modelGateway } from './ModelGateway.js'
import { executionTrace } from '../observability/ExecutionTraceService.js'
import { sanitize } from './ResponseValidator.js'
export { sanitize } from './ResponseValidator.js'
import { runtimeConfigResolver, compileAgentInstructions } from '../config/RuntimeConfigResolver.js'
import {HybridRAG} from '../../rag/HybridRAG.js'
import { buildPrompt } from './promptBuilder.js'
import { routeMessage, type RouteResult } from './router.js'
import { routeByIntent, type DirectResponse, type QueryResponse } from './intentRouter.js'
import { formatVerifiedProperties } from '../../properties/PropertyMediaService.js'
import { generateContextReply } from './ConversationReplyEngine.js'
import type { ReplyContext, ReplyDialogueUpdate } from './ReplyContext.js'


function buildSafeFallback(route: RouteResult): string {
  if (route.lang === 'ar') {
    return route.isReturningUser
      ? 'أنا هنا لمساعدتك. هل تبحث عن شراء أو إيجار أو استثمار في دبي؟'
      : 'مرحباً! أنا أيا مساعدتك. هل تبحث عن شراء أو إيجار أو استثمار في دبي؟'
  }

  return route.isReturningUser
    ? 'I am here to help. Are you looking to buy, rent, or invest in Dubai?'
    : "Hi! I'm Aya your assistant. Are you looking to buy, rent, or invest in Dubai?"
}

function logRoutingAssertion(event: string, details: Record<string, unknown>): void {
  console.log(JSON.stringify({
    tag: 'AI_ROUTING_ASSERT',
    event,
    ...details,
  }))
}

export interface ReplyResult {
  dialogueUpdate?: ReplyDialogueUpdate
  reply: string
  executionTraceId?: string
  agentVersionId?: string
  retrievalTrace?: RouteResult['retrievalTrace']
  lane: RouteResult['lane']
  lang: 'en' | 'ar'
  handoff: boolean
  preferredHandoffMemberId?:string
  replyMode: 'prebuilt' | 'ai' | 'fallback'
  intent: ReturnType<typeof routeMessage> extends Promise<infer T> ? (T extends { intent: infer I } ? I : never) : never
  resolvedAgent?: RouteResult['resolvedAgent']
  shownPropertyRefs?: string[]
  propertySource?: 'direct' | 'indirect' | 'none'
  matchQuality?: 'exact' | 'partial' | 'none'
  matchedProperties?: number
}

async function generateReplyInternal(params: {
  orgId: string
  deviceId?: string
  contactId?: string
  conversationId?: string
  phoneNumber: string
  message: string
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  memory: Record<string, unknown>
  sock?: unknown
  replyContext?: ReplyContext
}): Promise<ReplyResult> {
  if (params.replyContext) return generateContextReply(params.replyContext, params.message, {deferPersistence:true})
  if (params.conversationId) await new HandoffCoordinator().assertAIAllowed(params.orgId, params.conversationId)
  executionTrace.memory(params.memory, 'memoryBefore')
  executionTrace.memory(params.memory, 'memoryAfter')
  const { orgId, message, conversationHistory, memory } = params
  if (requestsHuman(message)) {
    executionTrace.patch({confidence:'high',routingReason:'explicit_human_request'})
    return {reply:/[\u0600-\u06ff]/.test(message)?'تم تسجيل طلبك للتحدث مع أحد أعضاء الفريق.':'Your request to speak with our team has been recorded.',lane:'AGENT',lang:/[\u0600-\u06ff]/.test(message)?'ar':'en',handoff:true,replyMode:'prebuilt',intent:{} as never}
  }
  const channelRuntime = params.deviceId ? await runtimeConfigResolver.resolve(orgId, params.deviceId) : null

  // STEP 1: Run intent-based routing FIRST
  // This handles company, agent, and property intents WITHOUT AI
  const intentRoute = await routeByIntent({
    orgId,
    contactId: params.contactId,
    conversationId: params.conversationId,
    message,
    phoneNumber: params.phoneNumber,
    memory,
    agentConfig:channelRuntime?.config,
  })
  executionTrace.identify({ agentId: channelRuntime?.agentId ?? undefined, agentVersionId: channelRuntime?.publishedVersionId ?? undefined })
  const intentRouteType = intentRoute.type
  logRoutingAssertion('intent_route_received', {
    orgId,
    intentType: intentRouteType,
  })

  // COMPANY or AGENT: Return immediately, never call AI
  if (intentRoute.type === 'direct') {
    const directResponse = intentRoute as DirectResponse
    logRoutingAssertion('intent_direct_short_circuit', {
      routing: directResponse.metadata?.routing ?? 'company_handler',
      handoff: directResponse.metadata?.handoff === true,
    })
    return {
      reply: sanitize(directResponse.content),
      agentVersionId: channelRuntime?.publishedVersionId ?? undefined,
      lane: (directResponse.metadata?.routing === 'agent_handler' ? 'AGENT' : 'COMPANY') as RouteResult['lane'],
      lang: directResponse.language as 'en' | 'ar',
      handoff: directResponse.metadata?.handoff === true,
      replyMode: 'prebuilt',
      intent: {} as never,
      resolvedAgent: directResponse.metadata?.agent as RouteResult['resolvedAgent'],
    }
  }

  // PROPERTY: Handle result or no-result, never call AI for data
  if (intentRoute.type === 'query') {
    const queryResponse = intentRoute as QueryResponse
    const lang = queryResponse.language as 'en' | 'ar'
    logRoutingAssertion('intent_query_short_circuit', {
      found: queryResponse.data.found,
      propertyCount: queryResponse.data.properties?.length ?? 0,
      language: lang,
    })

    if (!queryResponse.data.found) {
      const noResultMessage = queryResponse.data.message
      return {
        reply: sanitize(noResultMessage ?? (
          lang === 'ar'
            ? 'عذراً، لا تتوفر لدينا قوائم عقارية تطابق بحثك حالياً. يمكنني مساعدتك في البحث بمعايير مختلفة أو التواصل مع أحد مستشارينا.'
            : "We don't currently have listings matching your search. I can help you search with different criteria or connect you with one of our consultants."
        )),
        agentVersionId:channelRuntime?.publishedVersionId ?? undefined,
        lane: 'PROPERTY',
        lang,
        handoff: channelRuntime?.config?.handoffPolicy?.automatic===true&&channelRuntime.config.handoffPolicy.onNoMatch===true,
        preferredHandoffMemberId:channelRuntime?.config?.handoffPolicy?.defaultMemberId??undefined,
        replyMode: 'prebuilt',
        intent: {} as never,
        propertySource: queryResponse.data.source ?? 'none',
        matchQuality: queryResponse.data.matchQuality ?? 'none',
        matchedProperties: 0,
      }
    }

    const properties = queryResponse.data.properties ?? []
    const propertySource = queryResponse.data.source ?? 'none'
    if (properties.length === 0) {
      logRoutingAssertion('property_no_rows_guard', {
        reason: 'found_true_but_empty_properties_array',
      })
      return {
        reply: sanitize(
          lang === 'ar'
            ? 'عذراً، لا تتوفر لدينا قوائم عقارية تطابق بحثك حالياً. يمكنني مساعدتك في البحث بمعايير مختلفة أو التواصل مع أحد مستشارينا.'
            : "We don't currently have listings matching your search. I can help you search with different criteria or connect you with one of our consultants.",
        ),
        agentVersionId:channelRuntime?.publishedVersionId ?? undefined,
        lane: 'PROPERTY',
        lang,
        handoff: false,
        replyMode: 'prebuilt',
        intent: {} as never,
      }
    }

    let reply = formatVerifiedProperties(properties, lang)
    if (queryResponse.data.matchQuality==='partial') reply=(lang==='ar'?'خيارات قريبة مع تخفيف معتمد للمعايير: ':'Close alternatives with approved relaxation: ')+(queryResponse.data.relaxedFields ?? []).join(', ')+'\n\n'+reply
    const allIndirect = properties.every((p) => String(p.source ?? propertySource).toLowerCase() === 'indirect')
    if (propertySource === 'indirect' && allIndirect) {
      reply += lang === 'ar'
        ? '\n\nبينما لا يتوفر هذا حالياً ضمن محفظتنا المباشرة، يمكن لفريقنا ترتيب المعاينة عبر شبكة شركائنا.'
        : '\n\nWhile we do not have this in our direct portfolio right now, our team can arrange access through our partner network.'
    }

    const shownPropertyRefs = properties
      .map((p) => p.ref_number || p.ref)
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)

    return {
      reply: sanitize(reply),
      agentVersionId:channelRuntime?.publishedVersionId ?? undefined,
      lane: 'PROPERTY',
      lang,
      handoff: false,
      replyMode: 'prebuilt',
      intent: {} as never,
      shownPropertyRefs,
      propertySource,
      matchQuality: queryResponse.data.matchQuality ?? 'exact',
      matchedProperties: properties.length,
    }
  }

  // STEP 2: For FAQ and GENERAL - use old router + AI (unchanged)
  // intentRoute.type === 'defer_to_ai' reaches here
  if (intentRouteType !== 'defer_to_ai') {
    logRoutingAssertion('legacy_router_blocked_unexpected_type', {
      unexpectedType: intentRouteType,
    })
    throw new Error(`Unexpected intent route type before legacy router: ${intentRouteType}`)
  }
  logRoutingAssertion('legacy_router_allowed', {
    reason: 'defer_to_ai',
  })
  const runtime = channelRuntime ?? await runtimeConfigResolver.resolve(orgId)
  const routed = await routeMessage({ message, orgId, memory, knowledgeBaseIds: runtime.config?.knowledgeBaseIds ?? [], agentVersionId:runtime.publishedVersionId ?? undefined })
  if(!routed.retrievalTrace && (routed.lane==='CHAT'||(routed.lane==='GENERAL'&&routed.generalType==='answer')) && runtime.config?.tools.includes('knowledge.search') && runtime.publishedVersionId){const retrieval=await new HybridRAG().retrieve(message,orgId,runtime.publishedVersionId,runtime.config.knowledgeBaseIds);routed.faqContext=retrieval.context;routed.retrievalTrace=retrieval.trace}
  if (runtime.config && !runtime.config.languages.includes(routed.lang)) routed.lang = runtime.config.languages[0]
  executionTrace.identify({ agentId: runtime.agentId ?? undefined, agentVersionId: runtime.publishedVersionId ?? undefined })
  const { companyProfile } = runtime
  const { systemPrompt, preBuiltContent } = buildPrompt(routed, conversationHistory.length, companyProfile, runtime.config?.identity.name)

  if (preBuiltContent) {
    return {
      reply: sanitize(preBuiltContent),
      agentVersionId: runtime.publishedVersionId ?? undefined, retrievalTrace: routed.retrievalTrace,
      lane: routed.lane,
      lang: routed.lang,
      handoff: Boolean(routed.handoff),
      replyMode: 'prebuilt',
      intent: routed.intent as never,
      resolvedAgent: routed.resolvedAgent,
      shownPropertyRefs: routed.shownPropertyRefs,
    }
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...conversationHistory.slice(-6),
    ...(routed.faqContext ? [{role:'user' as const,content:routed.faqContext}] : []),
    { role: 'user', content: message },
  ]

  const model = runtime.config ? await modelGateway.complete({ config: runtime.config, system: systemPrompt + '\n\n' + compileAgentInstructions(runtime), messages, route: routed }) : null
  let reply = model?.reply ?? ''
  let replyMode: ReplyResult['replyMode'] = 'ai'
  if (!reply) {
    replyMode = 'fallback'
    console.warn(`[AI][FALLBACK] Using deterministic fallback | lane=${routed.lane}`)
    reply = runtime.config ? buildSafeFallback(routed).replace(/Aya|أيا/g, runtime.config.identity.name) : (routed.lang === 'ar' ? 'المساعد غير مهيأ حالياً. يرجى التواصل مع الفريق.' : 'The assistant is not configured yet. Please contact the team.')
  }

  return {
    reply: sanitize(reply),
    agentVersionId: runtime.publishedVersionId ?? undefined,
    retrievalTrace:routed.retrievalTrace,
    lane: routed.lane,
    lang: routed.lang,
    handoff: false,
    replyMode,
    intent: routed.intent as never,
    resolvedAgent: routed.resolvedAgent,
    shownPropertyRefs: routed.shownPropertyRefs,
  }
}
import { HandoffCoordinator, requestsHuman } from '../handoff/HandoffCoordinator.js'

export async function generateReply(params: Parameters<typeof generateReplyInternal>[0]): Promise<ReplyResult> {
  return executionTrace.run({ orgId: params.orgId, deviceId: params.deviceId, conversationId: params.conversationId, source: 'helper' }, async () => {
    const result = await generateReplyInternal(params)
    executionTrace.reply(result)
    executionTrace.patch({ validationGates: [...((executionTrace.current()?.evidence.validationGates as unknown[]) ?? []), { name: 'sanitized_output', passed: !!result.reply.trim() }] })
    return { ...result, executionTraceId: executionTrace.current()?.id }
  })
}
