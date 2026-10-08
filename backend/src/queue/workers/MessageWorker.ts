import type { Job } from 'bullmq'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { DeviceLeaseService } from '../../whatsapp/DeviceLeaseService.js'

export interface MessageWorkerJob {
  orgId: string
  deviceId: string
  requestId: string
}

const schema = z.object({orgId:z.string().uuid(),deviceId:z.string().uuid(),requestId:z.string().uuid()}).strict()
export async function processMessageJob(job: Pick<Job<MessageWorkerJob>, 'data'>, context: {
  db: SupabaseClient; lease: DeviceLeaseService;
  send: (input: {orgId:string;deviceId:string;jid:string;text:string;messageId:string}) => Promise<{messageId:string|null}>
}): Promise<void> {
  const data = schema.parse(job.data)
  if (data.orgId !== context.lease.orgId || data.deviceId !== context.lease.deviceId) throw new Error('JOB_SCOPE_MISMATCH')
  await context.lease.assertOwned()
  const fence = context.lease.fence
  const params = {p_org:data.orgId,p_device:data.deviceId,p_id:data.requestId,p_owner:fence.ownerId,p_generation:fence.generation}
  const claim = await context.db.rpc('claim_device_send',params)
  if (claim.error) throw new Error('SEND_CLAIM_UNAVAILABLE')
  if (!claim.data) return
  let receipt: string | null = null, success = false
  try {
    await context.lease.assertOwned()
    const result = await context.send({orgId:data.orgId,deviceId:data.deviceId,jid:claim.data.jid,text:claim.data.content,messageId:claim.data.wa_message_id})
    receipt = result.messageId
    success = receipt === claim.data.wa_message_id
  } catch { /* Never retry an admitted send after an uncertain transport result. */ }
  const finish = await context.db.rpc('finish_device_send',{...params,p_receipt:receipt,p_success:success})
  if (finish.error) throw new Error('SEND_COMPLETION_UNAVAILABLE')
}
