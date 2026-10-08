import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { ConfigError } from '../config/AgentVersionService.js'
import { TeamRoutingService } from '../agents/TeamRoutingService.js'
import { HumanNotificationService } from './HumanNotificationService.js'
import { checkTenantReferences } from '../../api/tenant.js'
import { ConversationStateService } from '../contacts/ConversationStateService.js'

export function requestsHuman(text:string):boolean {
 const plain=text.normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/’/g,"'")
 if(/\b(?:don't|do not|dont)\s+(?:want|need|talk|speak|connect|transfer)[^.!?,]{0,35}\b(?:human|agent|person|representative|consultant)\b/i.test(plain)||/لا\s+(?:اريد|احتاج)[^،.!؟]{0,35}(?:موظف|انسان|مستشار|وكيل)/.test(plain))return false
 const normalized=plain.replace(/[,!?،؟]/g,' ').replace(/\s+/g,' ').trim()
 return /^(?:human|agent|live agent|real person|موظف|انسان)$/i.test(normalized)
  ||/\b(?:(?:speak|talk|connect|transfer|escalate|chat|put me through|get me|want|need|request|call)[\s\S]{0,45}(?:human|person|someone|somebody|agent|representative|manager|consultant|specialist|advisor|employee)|human please|agent please|live support)\b/i.test(normalized)
  ||/(?:اريد|ابغى|ابي|احتاج|اتحدث|اكلم|اتكلم|تواصل|حولني|وصلني)[\s\S]{0,45}(?:موظف|انسان|شخص|مستشار|وكيل|مدير|بشري)|(?:موظف|انسان|مدير)\s*(?:من فضلك|لو سمحت)/.test(normalized)
}
export interface HandoffConversation {id:string;org_id:string;contact_id:string;device_id:string|null;assigned_to:string|null;handoff_state:string;handoff_revision:number;handled_by:string;handoff_due_at:string|null}
export class HandoffCoordinator {
 constructor(private readonly db:SupabaseClient=getSupabaseAdmin(),private readonly routing=new TeamRoutingService(db),private readonly notifications=new HumanNotificationService(db)){}
 async read(orgId:string,id:string):Promise<HandoffConversation>{
  const {data,error}=await this.db.from('conversations').select('*').eq('org_id',orgId).eq('id',id).maybeSingle()
  if(error)throw new ConfigError(500,'HANDOFF_LOOKUP_FAILED','Handoff lookup failed')
  if(!data)throw new ConfigError(404,'CONVERSATION_NOT_FOUND','Conversation not found')
  const denial=await checkTenantReferences(this.db,orgId,[['contacts',data.contact_id],['devices',data.device_id],['team_members',data.assigned_to]])
  if(denial)throw new ConfigError(denial.status,denial.code,denial.error)
  return data as HandoffConversation
 }
 async assertAIAllowed(orgId:string,id:string):Promise<void>{
  const c=await this.read(orgId,id)
  if(['HUMAN_ACTIVE','RESOLVED'].includes(c.handoff_state)||(c.handled_by==='human'&&(!c.handoff_state||c.handoff_state==='AI_ACTIVE')))throw new ConfigError(409,'HUMAN_HANDOFF','AI is paused for this conversation')
 }
 async transition(orgId:string,id:string,action:string,input:{agentId?:string;actorId?:string;reason?:string;requestKey?:string;timeoutSeconds?:number;expectedRevision?:number}={}):Promise<HandoffConversation>{
  const {data,error}=await this.db.rpc('transition_handoff',{p_org_id:orgId,p_conversation_id:id,p_action:action,p_agent_id:input.agentId??null,p_actor_id:input.actorId??null,p_reason:input.reason??null,p_request_key:input.requestKey??null,p_timeout_seconds:input.timeoutSeconds??300,p_expected_revision:input.expectedRevision??null})
  if(error)throw new ConfigError(error.code==='PT404'?404:error.code==='42501'?403:error.code==='PT409'?409:500,'HANDOFF_TRANSITION_FAILED',error.message)
  return data as HandoffConversation
 }
 async request(orgId:string,id:string,input:{actorId?:string;reason?:string;requestKey?:string;area?:string;budget?:number;preferredMemberId?:string}={}):Promise<HandoffConversation>{
  let c=await this.transition(orgId,id,'request',input)
  if(c.handoff_state==='HANDOFF_REQUESTED'&&input.preferredMemberId&&(await this.routing.members(orgId)).some(m=>m.id===input.preferredMemberId))c=await this.assign(orgId,id,input.preferredMemberId,input.actorId,c.handoff_revision)
  if(c.handoff_state==='HANDOFF_REQUESTED')c=await this.assignBest(orgId,id,input)
  return c
 }
 async assignBest(orgId:string,id:string,input:{actorId?:string;area?:string;budget?:number;excludeId?:string}={}):Promise<HandoffConversation>{
  const current=await this.read(orgId,id)
  if(current.handoff_state!=='HANDOFF_REQUESTED')return current
  // Manual requests and restarted workers use the same persisted criteria as
  // the customer conversation, rather than silently losing its area/budget.
  const context=await new ConversationStateService(this.db).read(orgId,id,current.contact_id)
  const member=await this.routing.select(orgId,{...input,area:context.criteria.area??input.area,budget:context.criteria.maxPrice??input.budget})
  if(!member)return this.read(orgId,id)
  return this.assign(orgId,id,member.id,input.actorId,current.handoff_revision)
 }
 async assign(orgId:string,id:string,agentId:string,actorId?:string,expectedRevision?:number):Promise<HandoffConversation>{
  const members=await this.routing.members(orgId)
  if(!members.some(m=>m.id===agentId))throw new ConfigError(404,'AGENT_UNAVAILABLE','Available team member not found')
  const {data:org,error}=await this.db.from('organizations').select('settings').eq('id',orgId).single()
  if(error)throw new ConfigError(500,'HANDOFF_POLICY_FAILED','Handoff policy lookup failed')
  const timeoutSeconds=Number(org?.settings?.handoff?.sla?.agentAcceptSeconds ?? 120)
  const c=await this.transition(orgId,id,'assign',{agentId,actorId,expectedRevision,timeoutSeconds:Number.isFinite(timeoutSeconds)?timeoutSeconds:120})
  await this.notifications.dispatch(orgId,id)
  return this.transition(orgId,id,'waiting',{agentId:c.assigned_to??undefined})
 }
 async recover(orgId:string,deviceId?:string):Promise<void>{
  let query=this.db.from('conversations').select('*').eq('org_id',orgId).in('handoff_state',['HANDOFF_REQUESTED','ASSIGNED','WAITING_FOR_AGENT'])
  if(deviceId)query=query.eq('device_id',deviceId)
  const {data,error}=await query
  if(error)throw new ConfigError(500,'HANDOFF_RECOVERY_FAILED','Handoff recovery lookup failed')
  for(const c of data??[]){
   if(c.handoff_state==='HANDOFF_REQUESTED'){await this.assignBest(orgId,c.id);continue}
   const {data:agent,error:agentError}=await this.db.from('team_members').select('active,available').eq('org_id',orgId).eq('id',c.assigned_to).maybeSingle()
   if(agentError)throw new ConfigError(500,'TEAM_LOOKUP_FAILED','Assigned team lookup failed')
   if(!agent?.active||!agent.available){const expired=await this.db.from('conversations').update({handoff_due_at:new Date(0).toISOString()}).eq('org_id',orgId).eq('id',c.id).eq('handoff_revision',c.handoff_revision).in('handoff_state',['ASSIGNED','WAITING_FOR_AGENT']);if(expired.error)throw new ConfigError(500,'HANDOFF_RECOVERY_FAILED','Unable to expire unavailable assignment')}
   if(!agent?.active||!agent.available||(c.handoff_due_at&&Date.parse(c.handoff_due_at)<=Date.now())){
    const reset=await this.transition(orgId,c.id,'timeout')
    if(reset.handoff_state==='HANDOFF_REQUESTED')await this.assignBest(orgId,c.id,{excludeId:c.assigned_to})
   }else{
    await this.notifications.dispatch(orgId,c.id)
    if(c.handoff_state==='ASSIGNED')await this.transition(orgId,c.id,'waiting',{agentId:c.assigned_to})
   }
  }
 }
}
