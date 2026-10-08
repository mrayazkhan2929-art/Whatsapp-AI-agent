import { executionTrace } from '../modules/observability/ExecutionTraceService.js'
import { MessageIdempotencyService } from './MessageIdempotencyService.js'
import { OutboundMessageService, type DurableSendInput, type DurableTextSender } from './OutboundMessageService.js'
import type { WAMessage } from '@whiskeysockets/baileys'
import { generateReply } from '../modules/ai/aiService.js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../config/supabase.js'
import { HandoffCoordinator, requestsHuman } from '../modules/handoff/HandoffCoordinator.js'
import { ConfigError } from '../modules/config/AgentVersionService.js'
import type { NotificationSender } from '../modules/handoff/HumanNotificationService.js'
import { HumanNotificationService } from '../modules/handoff/HumanNotificationService.js'
import { TeamRoutingService } from '../modules/agents/TeamRoutingService.js'

interface MessageContext {
  deviceId: string
  orgId: string
  message: WAMessage
  contactId?: string
}

export class MessageRouter {
  private readonly supabase = isSupabaseConfigured() ? getSupabaseAdmin() : null
  private handlers: Map<string, (context: MessageContext) => Promise<void>>

  constructor(private readonly dependencies: { generateReply?: typeof generateReply; send?: DurableTextSender; notify?:NotificationSender } = {}) {
    this.handlers = new Map()
  }

  registerHandler(type: string, handler: (context: MessageContext) => Promise<void>): void {
    this.handlers.set(type, handler)
  }

  async routeMessage(deviceId: string, orgId: string, message: WAMessage): Promise<void> {
    if (!this.supabase || message.key?.fromMe) return
    await executionTrace.run({ orgId, deviceId, source: 'whatsapp' }, () => this.routeMessageInternal(deviceId, orgId, message))
  }

  private async routeMessageInternal(deviceId: string, orgId: string, message: WAMessage): Promise<void> {
    if (!this.supabase || message.key?.fromMe) return
    const senderJid = message.key?.remoteJid
    const waMessageId = message.key?.id
    if (!senderJid || !waMessageId?.trim() || waMessageId.length > 200) {
      executionTrace.outcome('skipped', 'INVALID_INBOUND_IDENTITY')
      console.error('Inbound rejected: missing or invalid WhatsApp identity')
      return
    }
    const persistence = new MessageIdempotencyService(this.supabase)
    const outbound = new OutboundMessageService(this.supabase, input => this.sendTextViaGateway(input))
    const content = this.extractMessageContent(message).trim()
    const messageType = this.getMessageType(message)
    try {
      const saved = await persistence.receive({ orgId, deviceId, waMessageId, jid: senderJid,
        phone: this.extractContactIdentifier(senderJid), name: message.pushName, content, type: messageType })
      executionTrace.identify({ conversationId: saved.conversation_id, inboundMessageId: saved.id })
      const token = await persistence.claim(saved)
      if (!token) {
        executionTrace.outcome('skipped', 'DUPLICATE_OR_CLAIMED_INBOUND')
        await outbound.resume(orgId, deviceId, saved.id)
        return
      }
      if (saved.message_type !== 'text' || !saved.content.trim()) {
        executionTrace.outcome('skipped', 'UNSUPPORTED_MEDIA')
        await persistence.stop(saved, token, true, null)
        return
      }
      try {
        const { data: conversation, error: conversationError } = await this.supabase.from('conversations')
          .select('id, org_id, contact_id').eq('id', saved.conversation_id).eq('org_id', orgId).single()
        if (conversationError || !conversation) throw new Error('Owned conversation unavailable')
        const { data: contact, error: contactError } = await this.supabase.from('contacts')
          .select('id, org_id, phone, name, language, contact_memory').eq('id', conversation.contact_id).eq('org_id', orgId).single()
        if (contactError || !contact) throw new Error('Owned contact unavailable')
        executionTrace.memory(contact.contact_memory ?? {}, 'memoryBefore'); executionTrace.memory(contact.contact_memory ?? {}, 'memoryAfter')
        const coordinator=new HandoffCoordinator(this.supabase,new TeamRoutingService(this.supabase),new HumanNotificationService(this.supabase,this.dependencies.notify))
        try { await coordinator.assertAIAllowed(orgId,saved.conversation_id) }
        catch(error){if(error instanceof ConfigError&&error.code==='HUMAN_HANDOFF'){executionTrace.outcome('skipped','HUMAN_HANDOFF');await persistence.stop(saved,token,true,'HUMAN_HANDOFF');return}throw error}
        const history = await this.loadConversationHistory(saved.conversation_id, orgId)
        const explicitArabic=/[\u0600-\u06ff]/.test(saved.content)||contact.language==='ar'
        let reply: Awaited<ReturnType<typeof generateReply>>
        try {
          const humanRequested=requestsHuman(saved.content)
          if(humanRequested)executionTrace.patch({confidence:'high',routingReason:'explicit_human_request'})
          reply = humanRequested
            ? {reply:explicitArabic?'تم تسجيل طلبك للتحدث مع أحد أعضاء الفريق.':'Your request to speak with our team has been recorded.',lane:'AGENT',lang:explicitArabic?'ar':'en',handoff:true,replyMode:'prebuilt',intent:{} as never}
            : await (this.dependencies.generateReply ?? generateReply)({ orgId, deviceId, contactId: contact.id, conversationId: saved.conversation_id,
            phoneNumber: contact.phone, message: saved.content, conversationHistory: history,
            memory: contact.contact_memory && typeof contact.contact_memory === 'object' ? { ...contact.contact_memory } : {} })
        } catch {
          executionTrace.patch({ fallback: true, failureReason: 'REPLY_GENERATION_FAILED' })
          reply = { reply: contact.language === 'ar'
            ? 'عذرًا، واجهنا مشكلة مؤقتة أثناء معالجة رسالتك. سيتابع معك فريقنا فورًا.'
            : 'Sorry, we encountered a temporary issue processing your message. Our team will follow up shortly.',
            lane: 'CHAT', lang: contact.language === 'ar' ? 'ar' : 'en', handoff: false, replyMode: 'fallback', intent: {} as never }
        }
        executionTrace.reply(reply)
        if(reply.handoff){const handoff=await coordinator.request(orgId,saved.conversation_id,{reason:'customer_request',requestKey:saved.id,preferredMemberId:reply.preferredHandoffMemberId,area:typeof contact.contact_memory?.area==='string'?contact.contact_memory.area:undefined,budget:Number(contact.contact_memory?.maxBudget)||undefined});executionTrace.tool('handoff.create',{reason:'customer_request'},{state:handoff.handoff_state,memberId:handoff.assigned_to});executionTrace.patch({handoffDecision:handoff.handoff_state})}
        try { await coordinator.assertAIAllowed(orgId,saved.conversation_id) }
        catch(error){if(error instanceof ConfigError&&error.code==='HUMAN_HANDOFF'){executionTrace.outcome('skipped','HUMAN_HANDOFF');await persistence.stop(saved,token,true,'HUMAN_HANDOFF');return}throw error}
        const handler = this.handlers.get(messageType) ?? this.handlers.get('text')
        if (handler) await handler({ orgId, deviceId, message, contactId: contact.id })
        const response = await outbound.prepare(saved, token, reply.reply, reply.agentVersionId, {
          executionTraceId: executionTrace.current()?.id,
          retrievalTrace: reply.retrievalTrace ?? null,
          last_property_sent: (reply.matchedProperties ?? 0) > 0,
          last_match_quality: reply.matchQuality ?? 'none', last_match_source: reply.propertySource ?? 'none',
          last_properties_sent_count: String(reply.matchedProperties ?? 0), last_property_sent_at: new Date().toISOString(),
        })
        executionTrace.identify({ outboundMessageId: response.id })
        await outbound.deliver(response)
      } catch (error) {
        // Never regenerate a response after a business or send outcome becomes uncertain.
        await persistence.stop(saved, token, false, 'EXECUTION_OUTCOME_UNKNOWN').catch(() => undefined)
        throw error
      }
    } catch (error) {
      executionTrace.outcome('failed', 'EXECUTION_OUTCOME_UNKNOWN')
      console.error(JSON.stringify({ tag: 'WHATSAPP_EXECUTION_FAILED', traceId: executionTrace.current()?.id }))
    }
  }

  async resumePending(deviceId: string, orgId: string): Promise<void> {
    if (!this.supabase) return
    await new OutboundMessageService(this.supabase, input => this.sendTextViaGateway(input)).resume(orgId, deviceId)
  }

  private async loadConversationHistory(
    conversationId: string,
    orgId: string,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    if (!this.supabase) {
      return []
    }

    const { data } = await this.supabase
      .from('messages')
      .select('content, direction, status')
      .eq('conversation_id', conversationId)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(8)

    return (data ?? [])
      .filter(row => row.direction === 'inbound' || ['sent', 'delivered', 'read'].includes(row.status))
      .slice()
      .reverse()
      .map((row) => ({
        role: row.direction === 'inbound' ? 'user' : 'assistant',
        content: row.content,
      }))
  }

  private getMessageType(message: WAMessage): string {
    const msg = this.unwrapMessageContent(message.message)

    if (!msg) {
      return 'unknown'
    }

    if (msg?.conversation) return 'text'
    if (msg?.extendedTextMessage) return 'text'
    if (msg?.imageMessage) return 'image'
    if (msg?.videoMessage) return 'video'
    if (msg?.audioMessage) return 'audio'
    if (msg?.documentMessage) return 'document'

    return 'unknown'
  }

  private extractMessageContent(message: WAMessage): string {
    const msg = this.unwrapMessageContent(message.message)

    if (!msg) {
      return '[Unsupported message type]'
    }

    if (msg?.conversation) return msg.conversation
    if (msg?.extendedTextMessage?.text) return msg.extendedTextMessage.text
    if (msg?.imageMessage?.caption) return msg.imageMessage.caption
    if (msg?.videoMessage?.caption) return msg.videoMessage.caption

    return '[Unsupported message type]'
  }

  private unwrapMessageContent(message: WAMessage['message']): WAMessage['message'] | null {
    let current = message

    for (let i = 0; i < 5; i += 1) {
      if (!current) {
        return null
      }

      const record = current as Record<string, unknown>
      const wrappers = [
        record.ephemeralMessage,
        record.viewOnceMessage,
        record.viewOnceMessageV2,
      ]

      const nested = wrappers.find(
        (entry): entry is { message?: WAMessage['message'] } =>
          typeof entry === 'object' && entry !== null && 'message' in entry,
      )

      if (!nested?.message) {
        return current
      }

      current = nested.message
    }

    return current ?? null
  }

  private extractContactIdentifier(senderJid: string): string {
    if (senderJid.endsWith('@s.whatsapp.net')) {
      return senderJid.replace('@s.whatsapp.net', '')
    }

    if (senderJid.endsWith('@c.us')) {
      return senderJid.replace('@c.us', '')
    }

    return senderJid
  }

  private async sendTextViaGateway(input: DurableSendInput): Promise<{ deviceId: string; messageId: string | null }> {
    if (this.dependencies.send) return this.dependencies.send(input)
    const { whatsAppGateway } = await import('./WhatsAppGateway.js')
    return whatsAppGateway.sendText(input)
  }
}
