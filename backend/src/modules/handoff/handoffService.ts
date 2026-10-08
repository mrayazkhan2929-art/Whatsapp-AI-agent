import { getSupabaseAdmin } from '../../config/supabase.js'
import { HandoffCoordinator } from './HandoffCoordinator.js'
import { findBestResolvedAgent,findResolvedAgentByName,resolvedAgentCard } from '../ai/agentResolver.js'
import { ConfigError } from '../config/AgentVersionService.js'
export const handoffService={
 async execute(params:{phoneNumber:string;orgId:string;reason:string;message:string}){
  const db=getSupabaseAdmin(),{data:contact,error}=await db.from('contacts').select('id').eq('org_id',params.orgId).eq('phone',params.phoneNumber.replace(/\D/g,'')).maybeSingle()
  if(error)throw new ConfigError(500,'CONTACT_LOOKUP_FAILED','Contact lookup failed')
  if(!contact)throw new ConfigError(404,'CONTACT_NOT_FOUND','Contact not found')
  const conversations=await db.from('conversations').select('id').eq('org_id',params.orgId).eq('contact_id',contact.id).eq('status','active')
  if(conversations.error)throw new ConfigError(500,'HANDOFF_LOOKUP_FAILED','Conversation lookup failed')
  for(const c of conversations.data??[])await new HandoffCoordinator(db).request(params.orgId,c.id,{reason:params.reason})
 },
 async getAgentContactForClient(orgId:string,agentNameHint?:string){const agent=agentNameHint?await findResolvedAgentByName(orgId,agentNameHint):await findBestResolvedAgent(orgId);return agent?resolvedAgentCard(agent):null},
}
