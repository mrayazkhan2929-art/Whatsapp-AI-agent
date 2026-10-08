import { Router } from 'express'
import { z } from 'zod'
import { getSupabaseAdmin } from '../../config/supabase.js'
import type { AuthenticatedRequest } from '../types.js'
import { ConfigError } from '../../modules/config/AgentVersionService.js'
import { HandoffCoordinator } from '../../modules/handoff/HandoffCoordinator.js'
import { TeamRoutingService } from '../../modules/agents/TeamRoutingService.js'
const router=Router()
const actionSchema=z.object({action:z.enum(['request','assign','accept','resolve','resume']),agentId:z.string().uuid().optional(),reason:z.string().max(200).optional()})
const ruleSchema=z.object({name:z.string().min(1).max(120),priority:z.number().int().min(0).max(10000),team_member_id:z.string().uuid(),areas:z.array(z.string().min(1).max(120)).max(50),min_budget:z.number().min(0),max_budget:z.number().min(0).nullable(),active:z.boolean()}).refine(v=>v.max_budget===null||v.max_budget>=v.min_budget,{message:'Maximum budget must be at least the minimum'})
const availabilitySchema=z.object({available:z.boolean(),working_hours:z.object({timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true}catch{return false}},'Invalid timezone'),days:z.array(z.number().int().min(0).max(6)).min(1).max(7),start:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),end:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)}).nullable()})
router.use((request:AuthenticatedRequest,response,next)=>{if(!request.auth||request.auth.role==='viewer'){response.status(403).json({code:'HANDOFF_FORBIDDEN',error:'Handoff access requires a team role'});return}next()})
router.get('/routing',async(request:AuthenticatedRequest,response)=>{
 const db=getSupabaseAdmin(),org=request.orgId!
 const [rules,members]=await Promise.all([db.from('agent_routing_rules').select('*').eq('org_id',org).order('priority').order('id'),db.from('team_members').select('id,name,role,active,available,working_hours').eq('org_id',org).order('name')])
 if(rules.error||members.error){response.status(500).json({error:'Routing lookup failed'});return}response.json({data:rules.data,teamMembers:members.data})
})
router.post('/routing',async(request:AuthenticatedRequest,response)=>{
 if(!['owner','admin'].includes(request.auth!.role)){response.status(403).json({error:'Administrator required'});return}
 const parsed=ruleSchema.safeParse(request.body);if(!parsed.success){response.status(400).json({error:parsed.error.issues[0]?.message});return}
 const db=getSupabaseAdmin(),member=await db.from('team_members').select('id').eq('org_id',request.orgId!).eq('id',parsed.data.team_member_id).maybeSingle()
 if(member.error){response.status(500).json({error:'Team lookup failed'});return}if(!member.data){response.status(404).json({error:'Team member not found'});return}
 const saved=await db.from('agent_routing_rules').insert({...parsed.data,org_id:request.orgId!}).select('*').single()
 if(saved.error){response.status(500).json({error:'Routing save failed'});return}response.status(201).json({data:saved.data})
})
router.delete('/routing/:id',async(request:AuthenticatedRequest,response)=>{
 if(!['owner','admin'].includes(request.auth!.role)){response.status(403).json({error:'Administrator required'});return}
 if(!z.string().uuid().safeParse(request.params.id).success){response.status(400).json({error:'Invalid rule ID'});return}
 const result=await getSupabaseAdmin().from('agent_routing_rules').delete().eq('org_id',request.orgId!).eq('id',request.params.id).select('id')
 if(result.error){response.status(500).json({error:'Rule delete failed'});return}if(!result.data?.length){response.status(404).json({error:'Rule not found'});return}response.json({success:true})
})
router.patch('/team/:id/availability',async(request:AuthenticatedRequest,response)=>{
 if(!['owner','admin'].includes(request.auth!.role)){response.status(403).json({error:'Administrator required'});return}
 const parsed=availabilitySchema.safeParse(request.body);if(!parsed.success||!z.string().uuid().safeParse(request.params.id).success){response.status(400).json({error:'Invalid availability'});return}
 const result=await getSupabaseAdmin().from('team_members').update(parsed.data).eq('org_id',request.orgId!).eq('id',request.params.id).select('id').maybeSingle()
 if(result.error){response.status(500).json({error:'Availability save failed'});return}if(!result.data){response.status(404).json({error:'Team member not found'});return}response.json({success:true})
})
router.get('/',async(request:AuthenticatedRequest,response)=>{
 const {data,error}=await getSupabaseAdmin().from('conversations').select('id,handoff_state,handoff_reason,assigned_to,handoff_due_at,handoff_revision,updated_at').eq('org_id',request.orgId!).neq('handoff_state','AI_ACTIVE').order('updated_at',{ascending:false}).limit(100)
 if(error){response.status(500).json({error:'Handoff lookup failed'});return}response.json({data})
})
router.get('/:id',async(request:AuthenticatedRequest,response)=>{
 try{
  if(!z.string().uuid().safeParse(request.params.id).success){response.status(400).json({error:'Invalid conversation ID'});return}
  const db=getSupabaseAdmin(),coordinator=new HandoffCoordinator(db),c=await coordinator.read(request.orgId!,request.params.id as string)
  const [events,notifications,members]=await Promise.all([db.from('handoff_events').select('id,event_type,from_state,to_state,created_at,trigger_value,status,actor_id').eq('org_id',request.orgId!).eq('conversation_id',c.id).order('created_at'),db.from('handoff_notifications').select('id,status,failure_code,team_member_id,created_at').eq('org_id',request.orgId!).eq('conversation_id',c.id).order('created_at'),new TeamRoutingService(db).members(request.orgId!)])
  if(events.error||notifications.error)throw new ConfigError(500,'HANDOFF_LOOKUP_FAILED','Handoff detail lookup failed')
  response.json({data:c,events:events.data,notifications:notifications.data,teamMembers:members.map(m=>({id:m.id,name:m.name}))})
 }catch(error){const e=error instanceof ConfigError?error:new ConfigError(500,'HANDOFF_FAILED','Handoff lookup failed');response.status(e.status).json({error:e.message,code:e.code})}
})
router.post('/:id',async(request:AuthenticatedRequest,response)=>{
 try{
  const parsed=actionSchema.safeParse(request.body);if(!parsed.success||!z.string().uuid().safeParse(request.params.id).success){response.status(400).json({error:'Invalid handoff action'});return}
  const db=getSupabaseAdmin(),coordinator=new HandoffCoordinator(db),org=request.orgId!,id=request.params.id as string
  let c=await coordinator.read(org,id)
  if(parsed.data.action==='accept'&&!['owner','admin','operator'].includes(request.auth!.role)){
   const member=await db.from('team_members').select('email').eq('org_id',org).eq('id',c.assigned_to??'00000000-0000-0000-0000-000000000000').maybeSingle()
   if(member.error)throw new ConfigError(500,'TEAM_LOOKUP_FAILED','Team lookup failed')
   if(member.data?.email.toLowerCase()!==request.auth!.email.toLowerCase())throw new ConfigError(403,'ASSIGNEE_REQUIRED','Only the assigned member or an operator can accept')
  }
  const input={actorId:request.auth!.userId,reason:parsed.data.reason??'manual'}
  if(parsed.data.action==='request')c=await coordinator.request(org,id,input)
  else if(parsed.data.action==='assign'){
   if(!parsed.data.agentId)throw new ConfigError(400,'AGENT_REQUIRED','Select a team member')
   c=await coordinator.assign(org,id,parsed.data.agentId,input.actorId)
  }else c=await coordinator.transition(org,id,parsed.data.action,input)
  response.json({data:c})
 }catch(error){const e=error instanceof ConfigError?error:new ConfigError(500,'HANDOFF_FAILED','Handoff action failed');response.status(e.status).json({error:e.message,code:e.code})}
})
export default router
