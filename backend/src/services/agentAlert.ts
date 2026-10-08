import { getSupabaseAdmin } from '../config/supabase.js'
import { HandoffCoordinator } from '../modules/handoff/HandoffCoordinator.js'
import { ConfigError } from '../modules/config/AgentVersionService.js'
import type { ResolvedAgent } from '../modules/ai/agentResolver.js'
export interface LeadAlert {clientPhone:string;message:string;area?:string;beds?:string;transactionType?:string;budget?:number;propertyCards?:string[];lang:'en'|'ar';orgId:string;timestamp:string}
export async function sendAgentAlert(_agent:ResolvedAgent,alert:LeadAlert):Promise<void>{
 const db=getSupabaseAdmin(),{data:contact,error}=await db.from('contacts').select('id').eq('org_id',alert.orgId).eq('phone',alert.clientPhone.replace(/\D/g,'')).maybeSingle()
 if(error)throw new ConfigError(500,'CONTACT_LOOKUP_FAILED','Contact lookup failed')
 if(!contact)throw new ConfigError(404,'CONTACT_NOT_FOUND','Contact not found')
 const {data:conversations,error:conversationError}=await db.from('conversations').select('id').eq('org_id',alert.orgId).eq('contact_id',contact.id).eq('status','active')
 if(conversationError)throw new ConfigError(500,'HANDOFF_LOOKUP_FAILED','Conversation lookup failed')
 for(const c of conversations??[])await new HandoffCoordinator(db).request(alert.orgId,c.id,{reason:'lead_alert',area:alert.area,budget:alert.budget})
}
