import {expect,it} from 'vitest'
import {requestsHuman} from '../../backend/src/modules/handoff/HandoffCoordinator'
import {isWithinHours,TeamRoutingService} from '../../backend/src/modules/agents/TeamRoutingService'
import {fakeSupabase} from '../support/fake-supabase'

const humanRequests=['Connect me with an agent','I want a human','Speak to a real person','Transfer me to a representative','Please let me talk to your manager','Can I chat with a live person?','Human please','Agent please','I need live support','Put me through to a human','أريد التحدث مع موظف','أريد إنسان','احتاج مستشار','حولني إلى شخص حقيقي','أبي أكلم مدير','وصلني مع وكيل','مُوظف من فضلك','Human, please','Can I speak to someone?','Connect me with a consultant','I need a specialist','Human','I do not want AI, I need a human']
for(const message of humanRequests)it('detects explicit request: '+message,()=>expect(requestsHuman(message)).toBe(true))
for(const message of ['Hi','2 bedrooms in Marina','What is your office address?','This apartment is a real bargain','The manager owns this property','I do not want a human','لا أريد موظف'])it('does not escalate an ordinary message: '+message,()=>expect(requestsHuman(message)).toBe(false))
it('supports local after hours, invalid zones and overnight schedules',()=>{
 const now=new Date('2026-10-07T18:00:00Z')
 expect(isWithinHours(null,now)).toBe(true)
 expect(isWithinHours({timezone:'Asia/Dubai',days:[3],start:'09:00',end:'18:00'},now)).toBe(false)
 expect(isWithinHours({timezone:'Asia/Dubai',days:[3],start:'21:00',end:'06:00'},now)).toBe(true)
 expect(isWithinHours({timezone:'Bad/Zone',days:[3],start:'00:00',end:'23:59'},now)).toBe(false)
})
it('routes by tenant rules without hardcoded employees, then uses tenant default',async()=>{
 const db=fakeSupabase({organizations:[{id:'a',settings:{team:{defaultHandoffAgentId:'fallback'}}}],team_members:[{id:'expert',org_id:'a',name:'Expert',active:true,available:true},{id:'fallback',org_id:'a',active:true,available:true},{id:'foreign',org_id:'b',active:true,available:true}],agent_routing_rules:[{id:'rule',org_id:'a',team_member_id:'expert',active:true,areas:['Marina'],min_budget:100,max_budget:200}],conversations:[]})
 const service=new TeamRoutingService(db as never)
 expect((await service.select('a',{area:'Marina',budget:150}))?.id).toBe('expert')
 expect((await service.select('a',{area:'Marina',budget:250}))?.id).toBe('fallback')
 expect(await service.select('missing')).toBeNull()
})
it('uses stored budget tiers and exact area aliases without a fixed VIP amount',async()=>{
 const db=fakeSupabase({organizations:[{id:'a',settings:{team:{defaultHandoffAgentId:'fallback'}}}],team_members:[{id:'specialist',org_id:'a',active:true,available:true,min_budget_aed:750000},{id:'fallback',org_id:'a',active:true,available:true}],agent_routing_rules:[],conversations:[]})
 const service=new TeamRoutingService(db as never)
 expect((await service.select('a',{budget:800000}))?.id).toBe('specialist')
 expect((await service.select('a',{budget:500000}))?.id).toBe('fallback')
})
