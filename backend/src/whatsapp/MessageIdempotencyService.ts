import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TransportMessage {
  id: string
  org_id: string
  device_id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  content: string
  wa_message_id: string
  message_type: string
  processing_status: 'received' | 'processing' | 'prepared' | 'sending' | 'completed' | 'ignored' | 'needs_review'
  metadata: { replyJid?: string; agentVersionId?: string | null }
}

/** Database admission is the correctness authority. No process-local fingerprints or locks. */
export class MessageIdempotencyService {
  constructor(private readonly db: SupabaseClient) {}

  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args)
    if (error) throw new Error(`Transport persistence failed (${name}): ${error.code ?? 'database_error'}`)
    return data as T
  }

  receive(input: { orgId: string; deviceId: string; waMessageId: string; jid: string; phone: string; name?: string | null; content: string; type: string }): Promise<TransportMessage> {
    return this.rpc('receive_whatsapp_message', {
      p_org_id: input.orgId, p_device_id: input.deviceId, p_wa_message_id: input.waMessageId,
      p_jid: input.jid, p_phone: input.phone, p_name: input.name ?? null, p_content: input.content, p_type: input.type,
    })
  }

  async admit(input: Parameters<MessageIdempotencyService['receive']>[0]): Promise<{message:TransportMessage;token:string|null}> {
    const token=randomUUID()
    const result=await this.rpc<{message:TransportMessage;claimed:boolean}>('admit_whatsapp_execution',{
      p_org_id:input.orgId,p_device_id:input.deviceId,p_wa_message_id:input.waMessageId,p_jid:input.jid,p_phone:input.phone,p_name:input.name??null,p_content:input.content,p_type:input.type,p_token:token,
    })
    return {message:result.message,token:result.claimed?token:null}
  }

  async claim(message: TransportMessage): Promise<string | null> {
    const token = randomUUID()
    const result = await this.rpc<TransportMessage | null>('claim_whatsapp_execution', {
      p_org_id: message.org_id, p_device_id: message.device_id, p_message_id: message.id, p_token: token,
    })
    return result ? token : null
  }

  async stop(message: TransportMessage, token: string, ignored: boolean, failureCode: string | null): Promise<void> {
    const result = await this.rpc<boolean>('stop_whatsapp_execution', {
      p_org_id: message.org_id, p_device_id: message.device_id, p_message_id: message.id,
      p_token: token, p_ignored: ignored, p_failure_code: failureCode,
    })
    if (!result) throw new Error('Execution claim lost')
  }
}
