import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { ConfigError } from '../config/AgentVersionService.js'
import { normalizeArea } from '../../properties/PropertySearchCriteria.js'

export interface RoutingMember {
 id:string;name:string;role:string;whatsapp:string;email:string;active:boolean;available:boolean;
 area_speciality:string[];speciality_areas:string[];min_budget_aed:number|null;budget_threshold_aed?:number|null;working_hours:unknown
}
export function isWithinHours(hours:unknown,now=new Date()):boolean {
 if(hours==null)return true
 try {
  const h=hours as {timezone:string;days:number[];start:string;end:string}
  if(!h.days?.length||!/^\d{2}:\d{2}$/.test(h.start)||!/^\d{2}:\d{2}$/.test(h.end))return false
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:h.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)
  const part=(name:string)=>parts.find(p=>p.type===name)?.value ?? ''
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(part('weekday')),time=part('hour')+':'+part('minute')
  return h.start<=h.end ? h.days.includes(day)&&time>=h.start&&time<h.end : (h.days.includes(day)&&time>=h.start)||(h.days.includes((day+6)%7)&&time<h.end)
 }catch{return false}
}
const norm=(value:string)=>(normalizeArea(value)??value).normalize('NFKC').toLocaleLowerCase().trim()
export class TeamRoutingService {
 constructor(private readonly db:SupabaseClient=getSupabaseAdmin()){}
 async members(orgId:string,now=new Date()):Promise<RoutingMember[]> {
  const {data,error}=await this.db.from('team_members').select('*').eq('org_id',orgId).eq('active',true).order('id')
  if(error)throw new ConfigError(500,'TEAM_LOOKUP_FAILED','Team lookup failed')
  return (data as RoutingMember[] ?? []).filter(m=>m.available!==false&&isWithinHours(m.working_hours,now))
 }
 async select(orgId:string,input:{area?:string;budget?:number;excludeId?:string}={},now=new Date()):Promise<RoutingMember|null> {
  const members=(await this.members(orgId,now)).filter(m=>m.id!==input.excludeId)
  if(!members.length)return null
  const [{data:rules,error:ruleError},{data:org,error:orgError},{data:work,error:workError}]=await Promise.all([
   this.db.from('agent_routing_rules').select('*').eq('org_id',orgId).eq('active',true).order('priority').order('id'),
   this.db.from('organizations').select('settings').eq('id',orgId).single(),
   this.db.from('conversations').select('assigned_to').eq('org_id',orgId).in('handoff_state',['ASSIGNED','WAITING_FOR_AGENT','HUMAN_ACTIVE']),
  ])
  if(ruleError||orgError||workError)throw new ConfigError(500,'ROUTING_LOOKUP_FAILED','Routing lookup failed')
  for(const rule of rules??[]){
   const member=members.find(m=>m.id===rule.team_member_id)
   if(member&&(!rule.areas.length||(input.area&&rule.areas.some((area:string)=>norm(area)===norm(input.area!))))
    &&(input.budget??0)>=Number(rule.min_budget)&&(rule.max_budget==null||(input.budget??0)<=Number(rule.max_budget)))return member
  }
  const settings=org?.settings?.team ?? {}
  if(settings.autoAssignEnabled===false)return null
  if(settings.roundRobinEnabled===true||settings.assignmentPriority==='round-robin'){
   const {data:assignments,error}=await this.db.from('handoff_events').select('assigned_to,created_at').eq('org_id',orgId).eq('event_type','assign').order('created_at',{ascending:false})
   if(error)throw new ConfigError(500,'ROUTING_LOOKUP_FAILED','Assignment history lookup failed')
   const latest=new Map<string,string>();for(const event of assignments??[])if(event.assigned_to&&!latest.has(event.assigned_to))latest.set(event.assigned_to,event.created_at)
   return members.sort((a,b)=>(latest.get(a.id)??'').localeCompare(latest.get(b.id)??'')||a.id.localeCompare(b.id))[0]
  }
  const counts=new Map<string,number>();for(const row of work??[])if(row.assigned_to)counts.set(row.assigned_to,(counts.get(row.assigned_to)??0)+1)
  const leastBusy=(list:RoutingMember[])=>list.sort((a,b)=>(counts.get(a.id)??0)-(counts.get(b.id)??0)||a.id.localeCompare(b.id))[0]
  if(input.budget!==undefined){
   const threshold=(m:RoutingMember)=>Number(m.min_budget_aed??m.budget_threshold_aed??0)
   const tiers=members.filter(m=>threshold(m)>0&&threshold(m)<=input.budget!)
   if(tiers.length){const highest=Math.max(...tiers.map(threshold));return leastBusy(tiers.filter(m=>threshold(m)===highest))}
  }
  if(settings.assignmentPriority==='area-expert'&&input.area){const experts=members.filter(m=>[...(m.area_speciality??[]),...(m.speciality_areas??[])].some(area=>norm(area)===norm(input.area!)));if(experts.length)return leastBusy(experts)}
  const fallback=members.find(m=>m.id===settings.defaultHandoffAgentId)
  return fallback??leastBusy(members)
 }
}
