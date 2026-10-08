import { z } from 'zod'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { agentConfigSchema, databaseError, ConfigError } from '../config/AgentVersionService.js'
import type { EffectiveAgentRuntimeConfig } from '../config/RuntimeConfigResolver.js'
import { criteriaFromLegacy, propertySearchCriteriaSchema } from '../../properties/PropertySearchCriteria.js'
import type { ConversationState } from '../contacts/ConversationStateService.js'

export const dialogueSchema = z.object({
  pendingClarification: z.enum(['transaction', 'location', 'selection', 'understanding']).nullable().default(null),
  requestedCount: z.number().int().min(1).max(20).nullable().default(null),
  lastListingRefs: z.array(z.string().min(1).max(120)).max(20).default([]),
  selectedListingRef: z.string().min(1).max(120).nullable().default(null),
}).strict()
export type DialogueState = z.infer<typeof dialogueSchema>
export interface ReplyDialogueUpdate {
  contactId: string
  expectedRevision: number
  criteria: ConversationState['criteria']
  shownRefs: string[]
  language: 'en'|'ar'
  dialogue: DialogueState
}
export interface ReplyContext {
  pendingUpdate?: ReplyDialogueUpdate
  runtime: EffectiveAgentRuntimeConfig
  conversation: { id: string; org_id: string; contact_id: string; handoff_state: string; handled_by: string }
  contact: { id: string; org_id: string; phone: string; name: string | null; language: string; contact_memory: Record<string, unknown> }
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  state: ConversationState
  dialogue: DialogueState
}
export async function loadReplyContext(orgId: string, deviceId: string, conversationId: string, inboundId?: string): Promise<ReplyContext> {
  const { data, error } = await getSupabaseAdmin().rpc('load_reply_context', {
    p_org_id: orgId, p_device_id: deviceId, p_conversation_id: conversationId, p_inbound_id: inboundId ?? null,
  })
  if (error) throw databaseError(error)
  if (!data || data.conversation.org_id !== orgId || data.contact.org_id !== orgId || data.conversation.contact_id !== data.contact.id)
    throw new ConfigError(404, 'CONTEXT_NOT_FOUND', 'Reply context was not found')
  const config = agentConfigSchema.parse(data.config)
  const state = data.state
  if (state && (state.org_id !== orgId || state.contact_id !== data.contact.id || state.schema_version !== 1))
    throw new ConfigError(500, 'INVALID_STATE', 'Conversation state is invalid')
  return {
    runtime: { orgId, deviceId, companyProfile: data.companyProfile, companyConfigured: !!data.companyProfile,
      agentId: data.agentId, publishedVersionId: data.agentVersionId, versionNumber: data.versionNumber, config },
    conversation: data.conversation, contact: data.contact,
    history: data.history.map((row: { direction: string; content: string }) => ({ role: row.direction === 'inbound' ? 'user' : 'assistant', content: row.content })),
    state: { conversationId, contactId: data.contact.id, criteria: state ? propertySearchCriteriaSchema.parse(state.criteria) : criteriaFromLegacy(data.contact.contact_memory),
      shownRefs: state?.shown_property_refs ?? [], language: state?.language ?? (data.contact.language === 'ar' ? 'ar' : 'en'), revision: state?.revision ?? 0 },
    dialogue: dialogueSchema.parse(state?.dialogue ?? {}),
  }
}
export function assertContextAIAllowed(context: ReplyContext) {
  if (['HUMAN_ACTIVE', 'RESOLVED'].includes(context.conversation.handoff_state) ||
      context.conversation.handled_by === 'human' && context.conversation.handoff_state === 'AI_ACTIVE')
    throw new ConfigError(409, 'HUMAN_HANDOFF', 'Conversation is handled by a human')
}
