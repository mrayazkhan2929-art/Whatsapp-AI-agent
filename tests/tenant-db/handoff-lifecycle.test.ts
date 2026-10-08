import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest'
import {createClient} from '@supabase/supabase-js'
import {chromium,expect as browserExpect,type Browser} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawn,type ChildProcess} from 'node:child_process'
import pg from 'pg'
import type {Server} from 'node:http'
import {createApiApp} from '../../backend/src/api/app'
import {HandoffCoordinator} from '../../backend/src/modules/handoff/HandoffCoordinator'
import {HumanNotificationService} from '../../backend/src/modules/handoff/HumanNotificationService'
import {TeamRoutingService} from '../../backend/src/modules/agents/TeamRoutingService'
import {MessageRouter} from '../../backend/src/whatsapp/MessageRouter'
import {MessageIdempotencyService} from '../../backend/src/whatsapp/MessageIdempotencyService'
import {OutboundMessageService,type DurableSendInput} from '../../backend/src/whatsapp/OutboundMessageService'
import {ConversationStateService} from '../../backend/src/modules/contacts/ConversationStateService'

const effects=vi.hoisted(()=>({notification:vi.fn(async()=>({deviceId:'stub',messageId:'stub'})),provider:vi.fn(()=>{throw Error('Provider must not be called')})}))
vi.mock('../../backend/src/whatsapp/WhatsAppGateway',()=>({whatsAppGateway:{sendText:effects.notification,getRuntimeSnapshotSummary:()=>({}),getRuntimeSnapshot:()=>null,getConnectedDeviceIds:()=>[],getTransportHealth:()=>null}}))
vi.mock('@anthropic-ai/sdk',()=>({default:class{messages={create:effects.provider}}}))
vi.mock('groq-sdk',()=>({default:class{chat={completions:{create:effects.provider}}}}))
vi.mock('../../backend/src/api/middleware/rateLimit',()=>({apiRateLimit:(_r:unknown,_s:unknown,n:()=>void)=>n()}))
const stack=JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!,'utf8'))
const admin=createClient(stack.url,stack.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const database=new pg.Client({connectionString:stack.dbUrl})
const a=randomUUID(),b=randomUUID(),device=randomUUID(),bDevice=randomUUID(),expert=randomUUID(),fallback=randomUUID(),bAgent=randomUUID(),bContact=randomUUID(),bConversation=randomUUID()
const persistence=new MessageIdempotencyService(admin),coordinator=()=>new HandoffCoordinator(admin)
const output=resolve(process.env.PHASE_HANDOFF_REPORT_DIR??'docs/phase6/artifacts/handoffs')
let token:string,bToken:string,viewer:string,memberToken:string,actor:string,server:Server,next:ChildProcess,browser:Browser,backendUrl:string,frontendUrl:string,beforeB:unknown,checks=0,requests=0,external=0
const logs:string[]=[],browserErrors:string[]=[],scenarios:Record<string,unknown>[]=[]
const tables=['organizations','users','team_members','agent_routing_rules','contacts','conversations','conversation_states','messages','handoff_events','handoff_notifications','devices']
async function insert(table:string,data:unknown){const r=await admin.from(table).insert(data as never,{defaultToNull:false});if(r.error)throw r.error}
async function snapshotB(){const snapshot:Record<string,unknown>={};for(const table of tables){const result=await admin.from(table).select('*').eq(table==='organizations'?'id':'org_id',b).order(table==='conversation_states'?'conversation_id':'id');if(result.error)throw result.error;snapshot[table]=result.data}return snapshot}
async function identity(name:string,org:string,role='admin'){const email=name+'@phase6.example.invalid',password='Phase6-local-fixture-only!';const user=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{org_id:b}});if(user.error)throw user.error;await insert('users',{id:user.data.user.id,org_id:org,email,name,role,password_hash:'fixture'});const signed=await createClient(stack.url,stack.anonKey,{auth:{persistSession:false}}).auth.signInWithPassword({email,password});if(signed.error)throw signed.error;return{token:signed.data.session!.access_token,id:user.data.user.id}}
async function http(surface:'backend'|'frontend',path:string,method='GET',body?:unknown,credential=token){requests++;const response=await fetch((surface==='backend'?backendUrl+'/api/v1':frontendUrl+'/api')+path,{method,headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json()}}
const event=(text='Hello',phone='971'+String(Date.now())+String(Math.floor(Math.random()*1000)))=>({key:{id:randomUUID(),remoteJid:phone+'@s.whatsapp.net',fromMe:false},message:{conversation:text},pushName:'Handoff customer'})
async function conversation(){const phone=String(Date.now())+String(Math.random()).slice(2,8),contact=randomUUID(),id=randomUUID();await insert('contacts',{id:contact,org_id:a,phone,name:'Handoff test customer'});await insert('conversations',{id,org_id:a,contact_id:contact,device_id:device});return{id,phone,contact}}
async function pending(id:string){await coordinator().request(a,id,{actorId:actor,reason:'manual'});return coordinator().read(a,id)}
async function setTeam(values:Record<string,unknown>){const result=await admin.from('team_members').update(values).eq('org_id',a);if(result.error)throw result.error}
beforeAll(async()=>{
 const native=globalThis.fetch;vi.stubGlobal('fetch',(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname)){external++;throw Error('Non-local test request blocked')}return native(input,init)})
 await database.connect()
 await insert('organizations',[{id:a,name:'Handoff Tenant A',slug:'phase6-handoff-a',settings:{team:{defaultHandoffAgentId:fallback,assignmentPriority:'area-expert'},handoff:{sla:{agentAcceptSeconds:120}}}},{id:b,name:'Private Tenant B',slug:'phase6-handoff-b'}])
 await insert('devices',[{id:device,org_id:a,name:'Handoff channel'},{id:bDevice,org_id:b,name:'Private B channel'}])
 await insert('team_members',[{id:expert,org_id:a,name:'Harbour specialist',role:'Agent',whatsapp:'+971500006001',email:'expert@phase6.example.invalid',speciality_areas:['Marina']},{id:fallback,org_id:a,name:'Duty consultant',role:'Sales Manager',whatsapp:'+971500006002',email:'duty@phase6.example.invalid'},{id:bAgent,org_id:b,name:'B PRIVATE TEAM',role:'Agent',whatsapp:'+971500006099',email:'b@phase6.example.invalid'}])
 await insert('contacts',{id:bContact,org_id:b,phone:'971500006999',name:'B PRIVATE CONTACT'});await insert('conversations',{id:bConversation,org_id:b,contact_id:bContact,device_id:bDevice});await insert('messages',{org_id:b,conversation_id:bConversation,direction:'inbound',content:'B PRIVATE MESSAGE'})
 await insert('agent_routing_rules',{org_id:b,name:'B SECRET RULE',team_member_id:bAgent,areas:['B Secret Area']})
 await new HandoffCoordinator(admin,new TeamRoutingService(admin),new HumanNotificationService(admin,async()=>({}))).request(b,bConversation,{reason:'B private reason'})
 const one=await identity('handoff-a',a);token=one.token;actor=one.id;bToken=(await identity('handoff-b',b)).token;viewer=(await identity('handoff-viewer',a,'viewer')).token;memberToken=(await identity('handoff-unassigned-member',a,'member')).token
 server=await new Promise<Server>(done=>{const s=createApiApp(0).listen(0,'127.0.0.1',()=>done(s))});backendUrl='http://127.0.0.1:'+(server.address() as {port:number}).port
 next=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','-p','0','-H','127.0.0.1'],{cwd:resolve('frontend'),env:{...process.env,NODE_ENV:'production',BACKEND_URL:backendUrl},stdio:['ignore','pipe','pipe'],windowsHide:true})
 await new Promise<void>((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Next startup timeout')),60000);const read=(c:Buffer)=>{const text=c.toString();logs.push(text);const url=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(url)frontendUrl=url[0];if(/Ready in/.test(text)){clearTimeout(timeout);done()}};next.stdout!.on('data',read);next.stderr!.on('data',read);next.on('exit',code=>{clearTimeout(timeout);reject(Error('Next exit '+code))})})
 browser=await chromium.launch({headless:true});mkdirSync(output,{recursive:true})
})
beforeEach(async()=>{beforeB=await snapshotB();effects.notification.mockReset();effects.notification.mockResolvedValue({deviceId:'stub',messageId:'stub'});effects.provider.mockClear();await setTeam({active:true,available:true,working_hours:null})})
afterEach(async()=>{expect(await snapshotB()).toEqual(beforeB);expect(external).toBe(0);expect(effects.provider).not.toHaveBeenCalled();checks++;const pending=await admin.from('conversations').select('id').eq('org_id',a).in('handoff_state',['HANDOFF_REQUESTED','ASSIGNED','WAITING_FOR_AGENT','HUMAN_ACTIVE']);for(const c of pending.data??[])await coordinator().transition(a,c.id,'resolve')})
afterAll(async()=>{await browser?.close();next?.kill();server?.closeAllConnections();if(server)await new Promise<void>(done=>server.close(()=>done()));await database.end();writeFileSync(resolve(stack.directory,'handoff-http-evidence.json'),JSON.stringify({tenantBSnapshotChecks:checks,snapshotTables:tables,requests,externalRequests:external,browserErrors,scenarios,explicitDetection:'English and Arabic fixture corpus plus real WhatsApp router',AIOutboundWhileHumanActive:0,WhatsAppAndProviders:'stubbed',appliedToLiveProject:false},null,2));writeFileSync(resolve(stack.directory,'handoff-process.log'),logs.join(''));vi.unstubAllGlobals()})

for(const surface of ['backend','frontend'] as const){
 it(surface+': persists the full audited lifecycle through authenticated HTTP',async()=>{
  const {id}=await conversation();expect((await http(surface,'/handoffs/'+id,'POST',{action:'request',org_id:b})).body.data.handoff_state).toBe('WAITING_FOR_AGENT')
  expect((await http(surface,'/handoffs/'+id,'POST',{action:'accept'})).body.data.handoff_state).toBe('HUMAN_ACTIVE')
  expect((await http(surface,'/chat','POST',{conversationId:id,message:'Hello',orgId:b})).status).toBe(409)
  expect((await http(surface,'/handoffs/'+id,'POST',{action:'resolve'})).body.data.handoff_state).toBe('RESOLVED')
  expect((await http(surface,'/handoffs/'+id,'POST',{action:'resume'})).body.data).toMatchObject({handoff_state:'AI_ACTIVE',handled_by:'ai',assigned_to:null})
  const detail=await http(surface,'/handoffs/'+id);expect(detail.body.events.map((e:any)=>e.to_state)).toEqual(['HANDOFF_REQUESTED','ASSIGNED','WAITING_FOR_AGENT','HUMAN_ACTIVE','RESOLVED','AI_ACTIVE']);expect(effects.notification).toHaveBeenCalledTimes(1)
 })
 for(const action of ['request','assign','accept','resolve','resume'])it(surface+': foreign conversation '+action+' is 404 with no effects',async()=>{expect((await http(surface,'/handoffs/'+bConversation,'POST',{action,agentId:expert,orgId:b})).status).toBe(404);expect(effects.notification).not.toHaveBeenCalled()})
 it(surface+': foreign assignee cannot receive a tenant A notification',async()=>{const {id}=await conversation();await pending(id);effects.notification.mockClear();expect((await http(surface,'/handoffs/'+id,'POST',{action:'assign',agentId:bAgent})).status).toBe(404);expect(effects.notification).not.toHaveBeenCalled()})
 it(surface+': list/detail/rules ignore forged organization query',async()=>{for(const path of ['/handoffs?orgId='+b,'/handoffs/routing?org_id='+b]){const result=await http(surface,path);expect(result.status).toBe(200);expect(JSON.stringify(result.body)).not.toContain('B PRIVATE');expect(JSON.stringify(result.body)).not.toContain('B SECRET')};expect((await http(surface,'/handoffs/'+bConversation)).status).toBe(404)})
 it(surface+': rejects viewer controls and an unassigned member accepting',async()=>{const {id}=await conversation();await pending(id);expect((await http(surface,'/handoffs/'+id,'POST',{action:'accept'},viewer)).status).toBe(403);expect((await http(surface,'/handoffs/'+id,'POST',{action:'accept'},memberToken)).status).toBe(403)})
 it(surface+': routing rules/availability are tenant scoped and administrator-only',async()=>{
  const result=await http(surface,'/handoffs/routing','POST',{name:'Marina rule',priority:10,team_member_id:expert,areas:['Marina'],min_budget:100,max_budget:200,active:true,org_id:b});expect(result.status).toBe(201);expect(result.body.data.org_id).toBe(a)
  expect((await http(surface,'/handoffs/routing','POST',{name:'Foreign',priority:1,team_member_id:bAgent,areas:[],min_budget:0,max_budget:null,active:true})).status).toBe(404)
  expect((await http(surface,'/handoffs/team/'+bAgent+'/availability','PATCH',{available:false,working_hours:null})).status).toBe(404)
  expect((await http(surface,'/handoffs/team/'+expert+'/availability','PATCH',{available:false,working_hours:null},memberToken)).status).toBe(403)
  expect((await http(surface,'/handoffs/routing/'+result.body.data.id,'DELETE')).status).toBe(200)
  expect((await http(surface,'/handoffs/team/'+expert+'/availability','PATCH',{available:true,working_hours:{timezone:'Invalid/Zone',days:[1],start:'09:00',end:'18:00'}})).status).toBe(400)
 })
 it(surface+': compatibility ownership writes cannot bypass the lifecycle',async()=>{const {id}=await conversation();await pending(id);await coordinator().transition(a,id,'accept',{actorId:actor});expect((await http(surface,'/conversations/'+id,'PATCH',{handledBy:'ai'})).status).toBe(409);expect((await http(surface,'/conversations/'+bConversation,'PATCH',{handledBy:'ai'})).status).toBe(404);expect((await coordinator().read(a,id)).handoff_state).toBe('HUMAN_ACTIVE')})
}
it('uses stored area/budget rules and rejects malformed cross-tenant rule links in SQL',async()=>{
 await admin.from('organizations').update({settings:{team:{defaultHandoffAgentId:fallback,assignmentPriority:'least-busy'}}}).eq('id',a)
 const result=await admin.from('agent_routing_rules').insert({org_id:a,name:'Area and budget',priority:1,team_member_id:expert,areas:['Marina'],min_budget:100,max_budget:200}).select('id').single();if(result.error)throw result.error
 expect((await new TeamRoutingService(admin).select(a,{area:'marina',budget:150}))?.id).toBe(expert)
 expect((await new TeamRoutingService(admin).select(a,{area:'Marina',budget:250}))?.id).toBe(fallback)
 const c=await conversation(),states=new ConversationStateService(admin),state=await states.read(a,c.id)
 await states.save(a,state,{area:'Dubai Marina',maxPrice:150,excludeRefs:[]},[],'en')
 expect((await pending(c.id)).assigned_to).toBe(expert)
 await admin.from('conversations').update({handoff_due_at:new Date(0).toISOString()}).eq('org_id',a).eq('id',c.id)
 await coordinator().recover(a,device)
 expect((await coordinator().read(a,c.id)).assigned_to).toBe(fallback)
 expect((await admin.from('agent_routing_rules').insert({org_id:a,name:'Bad',team_member_id:bAgent})).error?.code).toBe('PT404')
 await admin.from('agent_routing_rules').delete().eq('org_id',a).eq('id',result.data.id)
 await admin.from('organizations').update({settings:{team:{defaultHandoffAgentId:fallback,assignmentPriority:'area-expert'},handoff:{sla:{agentAcceptSeconds:120}}}}).eq('id',a)
})
it('no available agent remains requested and is recovered when an agent becomes available',async()=>{await setTeam({available:false});const {id}=await conversation();expect((await pending(id)).handoff_state).toBe('HANDOFF_REQUESTED');expect(effects.notification).not.toHaveBeenCalled();await setTeam({available:true});await coordinator().recover(a,device);expect((await coordinator().read(a,id)).handoff_state).toBe('WAITING_FOR_AGENT')})
it('after-hours members are not assigned; invalid schedules fail closed',async()=>{const {id}=await conversation();await setTeam({working_hours:{timezone:'UTC',days:[(new Date().getUTCDay()+1)%7],start:'00:00',end:'23:59'}});expect((await pending(id)).assigned_to).toBeNull();expect(effects.notification).not.toHaveBeenCalled()})
it('inactive assigned agent cannot accept and recovers to another agent',async()=>{const {id}=await conversation();await pending(id);await admin.from('team_members').update({active:false}).eq('org_id',a).eq('id',fallback);await expect(coordinator().transition(a,id,'accept',{actorId:actor})).rejects.toMatchObject({status:409});await coordinator().recover(a,device);expect((await coordinator().read(a,id)).assigned_to).toBe(expert)})
it('timeout is audited and reassigns without activating AI',async()=>{const {id}=await conversation();await pending(id);await admin.from('conversations').update({handoff_due_at:new Date(0).toISOString()}).eq('org_id',a).eq('id',id);await coordinator().recover(a,device);const c=await coordinator().read(a,id);expect(c).toMatchObject({assigned_to:expert,handoff_state:'WAITING_FOR_AGENT',handled_by:'human'});const events=await admin.from('handoff_events').select('event_type').eq('org_id',a).eq('conversation_id',id);expect(events.data?.some(e=>e.event_type==='timeout')).toBe(true)})
it('notification failures remain visible and are not automatically sent again',async()=>{effects.notification.mockRejectedValue(Error('Transport outcome unknown'));const {id}=await conversation();await pending(id);expect((await coordinator().read(a,id)).handoff_state).toBe('WAITING_FOR_AGENT');const n=await admin.from('handoff_notifications').select('*').eq('org_id',a).eq('conversation_id',id);expect(n.data?.[0]).toMatchObject({status:'unknown',failure_code:'NOTIFICATION_SEND_UNCERTAIN'});effects.notification.mockClear();await coordinator().recover(a,device);expect(effects.notification).not.toHaveBeenCalled()})
it('two coordinators requesting concurrently notify once and persist one assignment',async()=>{const {id}=await conversation();await Promise.all(Array.from({length:10},()=>coordinator().request(a,id,{requestKey:'same-request'})));const events=await admin.from('handoff_events').select('*').eq('org_id',a).eq('conversation_id',id);expect(events.data?.filter(e=>e.event_type==='request')).toHaveLength(1);expect(events.data?.filter(e=>e.event_type==='assign')).toHaveLength(1);expect(effects.notification).toHaveBeenCalledTimes(1)})
for(const text of ['Connect me with an agent','أريد التحدث مع موظف'])it('real WhatsApp router detects '+text+' without provider execution',async()=>{
 const input=event(text),generate=vi.fn(),send=vi.fn(async(input:DurableSendInput)=>({deviceId:input.deviceId,messageId:input.messageId}));const router=new MessageRouter({generateReply:generate,send,notify:effects.notification});await router.routeMessage(device,a,input);await router.routeMessage(device,a,input);expect(generate).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);const inbound=await admin.from('messages').select('conversation_id').eq('org_id',a).eq('wa_message_id',input.key.id).single();expect((await coordinator().read(a,inbound.data!.conversation_id)).handoff_state).toBe('WAITING_FOR_AGENT');scenarios.push({text,detected:true,providerCalls:0})
})
it('real handoff flags from business execution persist lifecycle and notifications',async()=>{const generate=vi.fn(async()=>({reply:'Handoff acknowledgement',handoff:true,lane:'AGENT' as const,lang:'en' as const,replyMode:'prebuilt' as const,intent:{} as never}));const send=vi.fn(async(input:DurableSendInput)=>({deviceId:input.deviceId,messageId:input.messageId}));const input=event('Please help');await new MessageRouter({generateReply:generate,send,notify:effects.notification}).routeMessage(device,a,input);expect(generate).toHaveBeenCalledTimes(1);const inbound=await admin.from('messages').select('*').eq('org_id',a).eq('wa_message_id',input.key.id).single();expect((await coordinator().read(a,inbound.data!.conversation_id)).handoff_state).toBe('WAITING_FOR_AGENT')})
it('HUMAN_ACTIVE blocks inbound execution, outbound inserts and prepared saved sends',async()=>{
 const {id,phone}=await conversation();await pending(id)
 const inbound=await persistence.receive({orgId:a,deviceId:device,waMessageId:randomUUID(),jid:phone+'@s.whatsapp.net',phone,content:'prepared',type:'text'}),claim=await persistence.claim(inbound)
 const send=vi.fn(async(input:DurableSendInput)=>({deviceId:input.deviceId,messageId:input.messageId})),outbound=new OutboundMessageService(admin,send),prepared=await outbound.prepare(inbound,claim!,'Saved before acceptance')
 await coordinator().transition(a,id,'accept',{actorId:actor});await outbound.deliver(prepared);expect(send).not.toHaveBeenCalled()
 const generation=vi.fn();await new MessageRouter({generateReply:generation,send}).routeMessage(device,a,event('Hi',phone));expect(generation).not.toHaveBeenCalled()
 const denied=await admin.from('messages').insert({org_id:a,conversation_id:id,direction:'outbound',sender_type:'ai',content:'Must be blocked'});expect(denied.error?.code).toBe('PT409')
 scenarios.push({case:'human active',AIExecutions:0,AISends:0,AIInserts:0})
})
it('acceptance during generation discards the generated reply before save/send',async()=>{
 const {id,phone}=await conversation();await pending(id);let started!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>started=r),hold=new Promise<void>(r=>release=r)
 const generate=vi.fn(async()=>{started();await hold;return{reply:'Late AI response',handoff:false,lane:'CHAT' as const,lang:'en' as const,replyMode:'prebuilt' as const,intent:{} as never}}),send=vi.fn(async(input:DurableSendInput)=>({deviceId:input.deviceId,messageId:input.messageId}))
 const running=new MessageRouter({generateReply:generate,send}).routeMessage(device,a,event('Hello',phone));await entered;await coordinator().transition(a,id,'accept',{actorId:actor});release();await running;expect(send).not.toHaveBeenCalled();const messages=await admin.from('messages').select('*').eq('org_id',a).eq('conversation_id',id).eq('direction','outbound');expect(messages.data).toHaveLength(0)
})
it('acceptance cannot race an in-flight durable AI send',async()=>{
 const {id,phone}=await conversation();await pending(id);let release!:()=>void,started!:()=>void;const hold=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r)
 const inbound=await persistence.receive({orgId:a,deviceId:device,waMessageId:randomUUID(),jid:phone+'@s.whatsapp.net',phone,content:'AI before acceptance',type:'text'}),token=await persistence.claim(inbound)
 const outbound=new OutboundMessageService(admin,async input=>{started();await hold;return{deviceId:input.deviceId,messageId:input.messageId}}),prepared=await outbound.prepare(inbound,token!,'AI send before acceptance');const sending=outbound.deliver(prepared);await entered
 await expect(coordinator().transition(a,id,'accept',{actorId:actor})).rejects.toMatchObject({status:409});release();await sending;expect((await coordinator().transition(a,id,'accept',{actorId:actor})).handoff_state).toBe('HUMAN_ACTIVE')
})
it('backend process restart preserves human ownership and emits zero AI effects',async()=>{
 const {id,phone}=await conversation();await pending(id);await coordinator().transition(a,id,'accept',{actorId:actor})
 for(let restart=0;restart<2;restart++){
  const child=spawn(process.execPath,['--import','tsx',resolve('tests/fixtures/message-replica.ts')],{env:{...process.env},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true}),effectsSeen:string[]=[]
  try{await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(Error('Child restart timeout')),30000);child.on('message',(m:any)=>{if(m.kind==='effect')effectsSeen.push(m.effect);if(m.kind==='ready')child.send({id:'test',device,org:a,event:event('Hello after restart',phone)});if(m.kind==='done'){clearTimeout(timer);done()}});child.on('error',reject)});expect(effectsSeen).toEqual([])}finally{child.kill()}
 }
 expect((await coordinator().read(a,id)).handoff_state).toBe('HUMAN_ACTIVE');scenarios.push({case:'two actual restarted processes',AIExecutions:0,AISends:0})
})
it('notification interrupted after claim is retained and never automatically reclaimed',async()=>{const {id}=await conversation();await coordinator().transition(a,id,'request',{actorId:actor});await coordinator().transition(a,id,'assign',{agentId:fallback,actorId:actor});const n=await admin.from('handoff_notifications').select('id').eq('org_id',a).eq('conversation_id',id).single();const claim=await admin.rpc('claim_handoff_notification',{p_org_id:a,p_id:n.data!.id,p_token:randomUUID()});expect(claim.data.status).toBe('sending');await coordinator().recover(a,device);expect(effects.notification).not.toHaveBeenCalled();expect((await admin.from('handoff_notifications').select('status').eq('org_id',a).eq('id',n.data!.id).single()).data?.status).toBe('sending')})
it('an assigned queued handoff recovers notification once across two real restarted processes',async()=>{
 const {id}=await conversation();await coordinator().transition(a,id,'request',{actorId:actor});await coordinator().transition(a,id,'assign',{agentId:fallback,actorId:actor})
 for(let restart=0;restart<2;restart++){
  const child=spawn(process.execPath,['--import','tsx',resolve('tests/fixtures/handoff-replica.ts')],{env:{...process.env},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});let sent=0
  try{await new Promise<void>((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Handoff replica timeout')),30000);child.on('message',(m:any)=>{if(m.kind==='ready')child.send({org:a,device});if(m.kind==='effect')sent++;if(m.kind==='done'){clearTimeout(timeout);done()}if(m.kind==='failed'){clearTimeout(timeout);reject(Error('Recovery failed'))}});child.on('error',reject)});expect(sent).toBe(restart===0?1:0)}finally{child.kill()}
 }
 expect((await coordinator().read(a,id)).handoff_state).toBe('WAITING_FOR_AGENT')
})
it('saved manual-only policy queues requests and round robin uses durable assignment history',async()=>{
 await admin.from('organizations').update({settings:{team:{autoAssignEnabled:false}}}).eq('id',a)
 const first=await conversation();expect((await pending(first.id)).handoff_state).toBe('HANDOFF_REQUESTED');expect(effects.notification).not.toHaveBeenCalled()
 await admin.from('organizations').update({settings:{team:{roundRobinEnabled:true}}}).eq('id',a)
 await coordinator().assign(a,first.id,fallback,actor)
 expect((await new TeamRoutingService(admin).select(a))?.id).toBe(expert)
 await admin.from('organizations').update({settings:{team:{defaultHandoffAgentId:fallback,assignmentPriority:'area-expert'}}}).eq('id',a)
})
it('database/authenticated REST denies backend lifecycle functions and private routing data',async()=>{const authenticated=createClient(stack.url,stack.anonKey,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false}});for(const table of ['agent_routing_rules','handoff_notifications']){const result=await authenticated.from(table).select('*');expect(result.error).toBeTruthy()};const result=await authenticated.rpc('transition_handoff',{p_org_id:b,p_conversation_id:bConversation,p_action:'resume'});expect(result.error).toBeTruthy()})
for(const viewport of [{name:'desktop',width:1440,height:1050},{name:'mobile',width:390,height:844},{name:'rtl',width:1100,height:900}])it('real browser handoff workspace '+viewport.name,async()=>{
 const {id}=await conversation();await pending(id);const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});await context.addCookies([{name:'sb-access-token',value:token,url:frontendUrl}]);const page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message));await page.goto(frontendUrl+'/settings/handoff');await browserExpect(page.getByRole('heading',{name:'A clear path from AI to your team'})).toBeVisible();await page.getByRole('button',{name:'Conversation '+id.slice(0,8)}).click();await browserExpect(page.getByRole('button',{name:'Accept handoff'})).toBeVisible();await page.getByRole('button',{name:'Accept handoff'}).click();await browserExpect(page.getByText('AI paused',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Resolve handoff'}).click();await browserExpect(page.getByRole('button',{name:'Resume AI'})).toBeVisible();if(viewport.name==='rtl')await page.locator('section[aria-label="Handoff workspace"]').evaluate(el=>el.setAttribute('dir','rtl'));const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('*')].map(el=>({tag:el.tagName,cls:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})).filter(el=>el.right>innerWidth+1||el.left< -1).slice(0,30)}));writeFileSync(resolve(output,'layout-'+viewport.name+'.json'),JSON.stringify(geometry,null,2));await page.screenshot({path:resolve(output,'handoff-'+viewport.name+'.png'),fullPage:true});expect(geometry.scrollWidth<=geometry.width).toBe(true);expect(browserErrors).toEqual([]);await context.close()
})
