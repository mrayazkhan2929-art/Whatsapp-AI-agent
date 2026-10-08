import { randomUUID } from 'node:crypto'
import { executionTrace } from '../../modules/observability/ExecutionTraceService.js'
import { Router } from 'express'
import { z } from 'zod'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { sendApiError } from '../http.js'
import type { AuthenticatedRequest } from '../types.js'
import { generateReply, sanitize } from '../../modules/ai/aiService.js'
import { checkTenantReferences } from '../tenant.js'
import { ConfigError } from '../../modules/config/AgentVersionService.js'
import { HandoffCoordinator,requestsHuman } from '../../modules/handoff/HandoffCoordinator.js'
import { detectPrimaryIntent } from '../../modules/ai/intentDetector.js'
import { runtimeConfigResolver } from '../../modules/config/RuntimeConfigResolver.js'

const router = Router()

const chatSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  phoneNumber: z.string().optional(),
  deviceId: z.string().uuid().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
})

function normalizeMemoryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (/^\d+$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

router.post('/', async (request: AuthenticatedRequest, response) => {
  const orgId = request.orgId
  if (!orgId) {
    sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required')
    return
  }

  const parsed = chatSchema.safeParse(request.body)
  if (!parsed.success) {
    sendApiError(response, 400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Invalid chat payload')
    return
  }

  const { message, conversationId, phoneNumber, history, deviceId } = parsed.data
  const supabase = getSupabaseAdmin()

  if (deviceId) { const denial = await checkTenantReferences(supabase, orgId, [['devices', deviceId]]); if (denial) { response.status(denial.status).json(denial); return } }
  return executionTrace.run({ orgId, deviceId, source: 'http' }, async () => {
  try {
  let resolvedPhoneNumber = phoneNumber ?? ''
  let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = history ?? []
  let memory: Record<string, unknown> = {}
  let resolvedContactId: string | undefined

  if (conversationId) {
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, contact_id, contacts(phone)').eq('contacts.org_id', orgId)
      .eq('org_id', orgId)
      .eq('id', conversationId)
      .maybeSingle<{ id: string; contact_id: string; contacts: { phone: string } | null }>()

    if (!conversation) {
      sendApiError(response, 404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found')
      return
    }
    executionTrace.identify({ conversationId })
    resolvedContactId=conversation.contact_id

    const denial = await checkTenantReferences(supabase, orgId, [['contacts', conversation.contact_id]])
    if (denial) { response.status(denial.status).json(denial); return }
    if (conversation.contacts?.phone) {
      resolvedPhoneNumber = conversation.contacts.phone
    }

    const { data: memRows } = await supabase
      .from('contact_memory')
      .select('key, value')
      .eq('contact_id', conversation.contact_id)

    memory = Object.fromEntries(
      (memRows ?? []).map((row) => [row.key, normalizeMemoryValue(row.value)]),
    )

    if (!history || history.length === 0) {
      const { data: msgRows } = await supabase
        .from('messages')
        .select('direction, content').eq('org_id', orgId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(16)

      conversationHistory = (msgRows ?? []).reverse().map((row) => ({
        role: (row.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: row.content as string,
      }))
    }
  }

  const normalizedPhone = resolvedPhoneNumber?.startsWith('+')
    ? resolvedPhoneNumber
    : (resolvedPhoneNumber ? `+${resolvedPhoneNumber.replace(/\D/g, '')}` : '+0000000000')

  let result
  if(conversationId){try{await new HandoffCoordinator(supabase).assertAIAllowed(orgId,conversationId)}catch(error){if(error instanceof ConfigError){sendApiError(response,error.status,error.code,error.message);return}sendApiError(response,500,'HANDOFF_LOOKUP_FAILED','Handoff lookup failed');return}}
  try {
    // Keep published related-record authorization at the HTTP boundary, even when
    // the reply provider is substituted. Company facts and explicit human requests
    // remain available independently of an AI agent configuration.
    if(!requestsHuman(message)&&detectPrimaryIntent(message).intent!=='company')await runtimeConfigResolver.resolve(orgId,deviceId)
    result = await generateReply({
    orgId,
    deviceId,
    conversationId,
    contactId:resolvedContactId,
    phoneNumber: normalizedPhone,
    message,
    conversationHistory,
    memory,
  }) } catch (error) {
    if (error instanceof ConfigError) { sendApiError(response, error.status, error.code, error.message); return }
    if(error instanceof z.ZodError){sendApiError(response,400,'INVALID_CRITERIA',error.issues[0]?.message ?? 'Invalid property criteria');return}
    sendApiError(response, 500, 'REPLY_FAILED', 'Reply generation failed'); return
  }

  executionTrace.reply(result)
  const safeReply = sanitize(result.reply)

  if (conversationId) {
    try {
      const coordinator=new HandoffCoordinator(supabase)
      if(result.handoff){const handoff=await coordinator.request(orgId,conversationId,{reason:'customer_request',preferredMemberId:result.preferredHandoffMemberId});executionTrace.tool('handoff.create',{reason:'customer_request'},{state:handoff.handoff_state,memberId:handoff.assigned_to});executionTrace.patch({handoffDecision:handoff.handoff_state})}
      await coordinator.assertAIAllowed(orgId,conversationId)
    }catch(error){if(error instanceof ConfigError){sendApiError(response,error.status,error.code,error.message);return}sendApiError(response,500,'HANDOFF_FAILED','Handoff failed');return}
    const outboundId=randomUUID()
    const saved=await supabase.from('messages').insert({
      id: outboundId,
      org_id: orgId,
      conversation_id: conversationId,
      direction: 'outbound',
      sender_type: 'ai',
      sender_name: 'Aya AI',
      content: safeReply,
      message_type: 'text',
      status: 'sent',
      metadata: {
        executionTraceId: executionTrace.current()?.id,
        lane: result.lane,
        lang: result.lang,
        replyMode: result.replyMode,
        propertyRefs: result.shownPropertyRefs ?? [],
        agentVersionId: result.agentVersionId ?? null,
        retrievalTrace: result.retrievalTrace ?? null,
      },
    })
    if(saved.error){sendApiError(response,saved.error.code==='PT409'?409:500,'REPLY_SAVE_FAILED','Reply could not be saved');return}

    executionTrace.identify({outboundMessageId:outboundId})
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        detected_lang: result.lang,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('org_id', orgId)
  }

  response.json({
    executionTraceId: executionTrace.current()?.id ?? null,
    reply: safeReply,
    agentVersionId: result.agentVersionId ?? null,
    retrievalTrace: result.retrievalTrace ?? null,
    language: result.lang,
    shouldHandoff: result.handoff,
    handoff: result.handoff,
    lane: result.lane,
    replyMode: result.replyMode,
    shownPropertyRefs: result.shownPropertyRefs ?? [],
    source: result.propertySource ?? 'none',
    matchQuality: result.matchQuality ?? 'none',
    matchedProperties: result.matchedProperties ?? 0,
    directCount: result.propertySource === 'direct' ? result.matchedProperties ?? 0 : 0,
    indirectCount: result.propertySource === 'indirect' ? result.matchedProperties ?? 0 : 0,
    resolvedAgent: result.resolvedAgent ?? null,
  })
  } finally { if(response.statusCode >= 400)executionTrace.outcome('failed', 'HTTP_' + response.statusCode) }
  })
})

export default router
