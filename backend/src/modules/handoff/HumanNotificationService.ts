import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { ConfigError } from '../config/AgentVersionService.js'

export type NotificationSender=(input:{orgId:string;deviceId:string|null;phone:string;text:string})=>Promise<unknown>
const gatewaySender:NotificationSender=async input=>{const {whatsAppGateway}=await import('../../whatsapp/WhatsAppGateway.js');return whatsAppGateway.sendText(input)}
export class HumanNotificationService {
 constructor(private readonly db:SupabaseClient=getSupabaseAdmin(),private readonly send:NotificationSender=gatewaySender){}
 async dispatch(orgId:string,conversationId:string):Promise<void>{
  const {data:pending,error}=await this.db.from('handoff_notifications').select('*').eq('org_id',orgId).eq('conversation_id',conversationId).eq('status','queued').order('created_at')
  if(error)throw new ConfigError(500,'NOTIFICATION_LOOKUP_FAILED','Notification lookup failed')
  for(const item of pending??[]){
   const token=randomUUID(),claim=await this.db.rpc('claim_handoff_notification',{p_org_id:orgId,p_id:item.id,p_token:token})
   if(claim.error)throw new ConfigError(500,'NOTIFICATION_CLAIM_FAILED','Notification claim failed')
   if(!claim.data)continue
   let status='failed',failure:string|null='NOTIFICATION_CONTEXT_MISSING'
   const [{data:agent,error:agentError},{data:conversation,error:conversationError}]=await Promise.all([
    this.db.from('team_members').select('whatsapp,active,available').eq('org_id',orgId).eq('id',item.team_member_id).maybeSingle(),
    this.db.from('conversations').select('device_id,assigned_to,handoff_state').eq('org_id',orgId).eq('id',conversationId).maybeSingle(),
   ])
   if(!agentError&&!conversationError&&agent?.active&&agent.available&&conversation&&conversation.assigned_to===item.team_member_id&&['ASSIGNED','WAITING_FOR_AGENT'].includes(conversation.handoff_state)){
    const phone=agent.whatsapp.replace(/\D/g,'')
    if(/^\d{8,15}$/.test(phone)){
     // Claim is durable before any side effect. An interrupted/uncertain send is never retried automatically.
     try{await this.send({orgId,deviceId:conversation.device_id,phone,text:`A conversation needs your attention. Open your inbox to accept it. Reference: ${conversationId}`});status='sent';failure=null}
     catch{status='unknown';failure='NOTIFICATION_SEND_UNCERTAIN'}
    }else failure='AGENT_PHONE_INVALID'
   }
   const saved=await this.db.from('handoff_notifications').update({status,failure_code:failure,updated_at:new Date().toISOString()}).eq('id',item.id).eq('org_id',orgId).eq('claim_token',token).eq('status','sending')
   if(saved.error)throw new ConfigError(500,'NOTIFICATION_SAVE_FAILED','Notification outcome could not be saved')
  }
 }
}
