import { executionTrace } from '../modules/observability/ExecutionTraceService.js'
import { randomBytes, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MessageIdempotencyService, type TransportMessage } from './MessageIdempotencyService.js'

export interface DurableSendInput { orgId: string; deviceId: string; jid: string; text: string; messageId: string }
export type DurableTextSender = (input: DurableSendInput) => Promise<{ deviceId: string; messageId: string | null }>

/** A response is persisted before send; an ambiguous send is never retried automatically. */
export class OutboundMessageService {
  private readonly persistence: MessageIdempotencyService
  constructor(private readonly db: SupabaseClient, private readonly send: DurableTextSender) {
    this.persistence = new MessageIdempotencyService(db)
  }

  prepare(inbound: TransportMessage, token: string, text: string, agentVersionId?: string, matchMetadata: Record<string, unknown> = {}): Promise<TransportMessage> {
    const {retrievalTrace,executionTraceId,...propertyMetadata}=matchMetadata
    return this.persistence.rpc('prepare_whatsapp_response', {
      p_org_id: inbound.org_id, p_device_id: inbound.device_id, p_message_id: inbound.id, p_token: token,
      p_text: text, p_outbound_wa_id: randomBytes(10).toString('hex').toUpperCase(),
      p_metadata: { agentVersionId: agentVersionId ?? null, retrievalTrace:retrievalTrace ?? null, executionTraceId: executionTraceId ?? null }, p_match_metadata: propertyMetadata,
    })
  }

  async deliver(message: TransportMessage): Promise<void> {
    const token = randomUUID()
    const claimed = await this.persistence.rpc<TransportMessage | null>('claim_whatsapp_send', {
      p_org_id: message.org_id, p_device_id: message.device_id, p_message_id: message.id, p_token: token,
    })
    if (!claimed) return
    let failure: string | null = null
    try {
      if (!claimed.metadata.replyJid) throw new Error('Saved recipient missing')
      const result = await this.send({ orgId: claimed.org_id, deviceId: claimed.device_id, jid: claimed.metadata.replyJid, text: claimed.content, messageId: claimed.wa_message_id })
      if (result.deviceId !== claimed.device_id || result.messageId !== claimed.wa_message_id) throw new Error('Transport receipt does not match saved identity')
    } catch {
      // Socket timeouts can happen after the remote accepts the message.
      failure = 'SEND_OUTCOME_UNKNOWN'
    }
    // A failed acknowledgement leaves `sending`, never a second outbound row/send.
    const finished = await this.persistence.rpc<boolean>('finish_whatsapp_send', {
      p_org_id: claimed.org_id, p_device_id: claimed.device_id, p_message_id: claimed.id,
      p_token: token, p_success: failure === null, p_failure_code: failure,
    })
    executionTrace.patch({ transport: failure === null ? 'sent' : 'review_required' })
    if (failure) executionTrace.outcome('failed', failure)
    if (!finished) throw new Error('Send claim lost')
  }

  async resume(orgId: string, deviceId: string, inboundId?: string): Promise<void> {
    // Re-query pending rows after each batch, so removal from the pending set does
    // not skip the next page. Competing replicas still claim each response once.
    for (;;) {
    let query = this.db.from('messages').select('*').eq('org_id', orgId).eq('device_id', deviceId)
      .eq('direction', 'outbound').eq('processing_status', 'prepared').order('created_at', { ascending: true }).limit(100)
    if (inboundId) query = query.eq('reply_to_message_id', inboundId)
    const { data, error } = await query
    if (error) throw new Error('Failed to load saved outbound responses')
    for (const row of data ?? []) await this.deliver(row as TransportMessage)
    if ((data?.length ?? 0) < 100) return
    }
  }
}
