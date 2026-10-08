import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest'
import {createClient} from '@supabase/supabase-js'
import {chromium,expect as browserExpect,type Browser} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawn,type ChildProcess} from 'node:child_process'
import pg from 'pg'
import type {Server} from 'node:http'
import {MessageRouter} from '../../backend/src/whatsapp/MessageRouter'
import {MessageIdempotencyService,type TransportMessage} from '../../backend/src/whatsapp/MessageIdempotencyService'
import {OutboundMessageService,type DurableSendInput} from '../../backend/src/whatsapp/OutboundMessageService'
import {createApiApp} from '../../backend/src/api/app'

vi.mock('../../backend/src/whatsapp/WhatsAppGateway',()=>({whatsAppGateway:{getRuntimeSnapshotSummary:()=>({}),getRuntimeSnapshot:()=>null,getConnectedDeviceIds:()=>[],getTransportHealth:()=>null}}))
vi.mock('../../backend/src/api/middleware/rateLimit',()=>({apiRateLimit:(_r:unknown,_s:unknown,n:()=>void)=>n()}))
const stack=JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!,'utf8'))
const admin=createClient(stack.url,stack.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const a=randomUUID(),b=randomUUID(),c=randomUUID(),device=randomUUID(),secondDevice=randomUUID(),bDevice=randomUUID(),cDevice=randomUUID(),bContact=randomUUID(),bConversation=randomUUID()
const persistence=new MessageIdempotencyService(admin)
const execute=vi.fn(async(_input: {message:string})=>({reply:'Verified durable reply',lane:'CHAT' as const,lang:'en' as const,handoff:false,replyMode:'prebuilt' as const,intent:{} as never}))
const send=vi.fn(async(input:DurableSendInput)=>({deviceId:input.deviceId,messageId:input.messageId}))
const router=()=>new MessageRouter({generateReply:execute,send})
const event=(id:string=randomUUID(),phone='971500009999')=>({key:{id,remoteJid:phone+'@s.whatsapp.net',fromMe:false},message:{conversation:'Hello durable transport'},pushName:'Durable test contact'})
const tables=['organizations','users','devices','contacts','contact_memory','conversations','conversation_states','messages','message_receipts','handoff_events']
let beforeB:unknown,checks=0,requests=0,nonlocalRequests=0,token:string,bToken:string,server:Server,next:ChildProcess,browser:Browser,backendUrl:string,frontendUrl:string
const children=new Set<ChildProcess>(),browserErrors:string[]=[],logs:string[]=[],scenarios:Record<string,unknown>[]=[]
async function insert(table:string,data:unknown){const result=await admin.from(table).insert(data as any);if(result.error)throw result.error}
async function snapshotB(){const result:Record<string,unknown>={};for(const table of tables){const query=admin.from(table).select('*');const rows=await(table==='contact_memory'?query.eq('contact_id',bContact):query.eq(table==='organizations'?'id':'org_id',b)).order(table==='message_receipts'?'received_at':table==='conversation_states'?'conversation_id':'id');if(rows.error)throw rows.error;result[table]=rows.data}return result}
async function rows(id:string,org=a,dev=device){const result=await admin.from('messages').select('*').eq('org_id',org).eq('device_id',dev);if(result.error)throw result.error;return result.data.filter(r=>r.wa_message_id===id||result.data.some(parent=>parent.wa_message_id===id&&parent.id===r.reply_to_message_id))}
async function received(id=randomUUID()){return persistence.receive({orgId:a,deviceId:device,waMessageId:id,jid:'971500009999@s.whatsapp.net',phone:'971500009999',content:'Hello saved response',type:'text'})}
async function identity(name:string,org:string){const email=name+'@phase5.example.invalid',password='Phase5-local-only-password!';const created=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{org_id:b}});if(created.error)throw created.error;await insert('users',{id:created.data.user.id,org_id:org,email,name,role:'admin',password_hash:'fixture',active:true});const c=createClient(stack.url,stack.anonKey,{auth:{persistSession:false}});const signed=await c.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;return signed.data.session!.access_token}
async function http(surface:'backend'|'frontend',path:string,method='GET',credential=token){requests++;const response=await fetch((surface==='backend'?backendUrl+'/api/v1':frontendUrl+'/api')+path,{method,headers:{authorization:'Bearer '+credential}});return{status:response.status,body:await response.json()}}
async function replica(){
 const child=spawn(process.execPath,['--import','tsx',resolve('tests/fixtures/message-replica.ts')],{cwd:resolve('.'),env:{...process.env},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});children.add(child)
 const effects:{execute:number;send:number}={execute:0,send:0};const pending=new Map<string,()=>void>()
 child.stdout!.on('data',c=>logs.push(c.toString()));child.stderr!.on('data',c=>logs.push(c.toString()))
 await new Promise<void>((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Replica startup timeout')),30000);child.on('message',(message:any)=>{if(message.kind==='ready'){clearTimeout(timeout);done()}if(message.kind==='effect'){effects[message.effect as 'execute'|'send']++}if(message.kind==='done'){pending.get(message.id)?.();pending.delete(message.id)}});child.on('exit',code=>{clearTimeout(timeout);if(code!==null&&code!==0)reject(Error('Replica exited '+code))})})
 return{effects,run:(input:ReturnType<typeof event>)=>new Promise<void>((done,reject)=>{const id=randomUUID();const timer=setTimeout(()=>reject(Error('Replica routing timeout')),30000);pending.set(id,()=>{clearTimeout(timer);done()});child.send({id,device,org:a,event:input})}),stop:()=>{child.kill();children.delete(child)}}
}
beforeAll(async()=>{
 const native=globalThis.fetch;vi.stubGlobal('fetch',(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname)){nonlocalRequests++;throw Error('Non-local test request blocked')}return native(input,init)})
 await insert('organizations',[{id:a,name:'Durable Tenant A',slug:'phase5-a'},{id:b,name:'Durable Tenant B sentinel',slug:'phase5-b'},{id:c,name:'Independent transport context',slug:'phase5-c'}])
 await insert('devices',[{id:device,org_id:a,name:'Durable device'},{id:secondDevice,org_id:a,name:'Second device'},{id:bDevice,org_id:b,name:'Private B device'},{id:cDevice,org_id:c,name:'Independent context device'}])
 await insert('contacts',{id:bContact,org_id:b,phone:'+500000002',name:'B SECRET'});await insert('conversations',{id:bConversation,org_id:b,contact_id:bContact,device_id:bDevice})
 await insert('messages',{org_id:b,conversation_id:bConversation,direction:'inbound',content:'B PRIVATE SENTINEL',wa_message_id:'B-PRIVATE-ID'})
 token=await identity('durable-a',a);bToken=await identity('durable-b',b)
 server=await new Promise<Server>(done=>{const s=createApiApp(0).listen(0,'127.0.0.1',()=>done(s))});backendUrl='http://127.0.0.1:'+(server.address() as {port:number}).port
 next=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','-p','0','-H','127.0.0.1'],{cwd:resolve('frontend'),env:{...process.env,NODE_ENV:'production',BACKEND_URL:backendUrl},stdio:['ignore','pipe','pipe'],windowsHide:true})
 await new Promise<void>((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Next startup timeout')),60000);const read=(c:Buffer)=>{const text=c.toString();logs.push(text);const url=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(url)frontendUrl=url[0];if(/Ready in/.test(text)){clearTimeout(timeout);done()}};next.stdout!.on('data',read);next.stderr!.on('data',read);next.on('exit',code=>{clearTimeout(timeout);reject(Error('Next exit '+code))})})
 browser=await chromium.launch({headless:true});mkdirSync((process.env.PHASE_TRANSPORT_REPORT_DIR ?? 'docs/phase5/artifacts/transport'),{recursive:true})
})
beforeEach(async()=>{beforeB=await snapshotB();execute.mockClear();send.mockReset();send.mockImplementation(async input=>({deviceId:input.deviceId,messageId:input.messageId}))})
afterEach(async()=>{expect(await snapshotB()).toEqual(beforeB);expect(nonlocalRequests).toBe(0);checks++;writeFileSync(resolve(stack.directory,'message-progress.json'),JSON.stringify({checks,requests}))})
afterAll(async()=>{for(const c of children)c.kill();await browser?.close();next?.kill();server?.closeAllConnections();if(server)await new Promise<void>(done=>server.close(()=>done()));writeFileSync(resolve(stack.directory,'message-http-evidence.json'),JSON.stringify({tenantBSnapshotChecks:checks,snapshotTables:tables,requests,nonlocalRequests,browserErrors,scenarios,providerAndWhatsApp:'stubbed at the existing orchestration/transport boundaries; real database/Auth/REST and child processes',appliedToLiveProject:false},null,2));writeFileSync(resolve(stack.directory,'message-process.log'),logs.join(''));vi.unstubAllGlobals()})

for(const mode of ['twice','10 concurrently','two independent router replicas'] as const)it('stores/executes/sends exactly once: '+mode,async()=>{
 const input=event(),first=router(),second=router()
 if(mode==='twice'){await first.routeMessage(device,a,input);await first.routeMessage(device,a,input)}else await Promise.all(Array.from({length:10},(_,i)=>(mode==='two independent router replicas'&&i%2?second:first).routeMessage(device,a,input)))
 expect(execute).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);const saved=await rows(input.key.id);expect(saved).toHaveLength(2);expect(saved.every(r=>r.processing_status==='completed')).toBe(true);expect(saved.find(r=>r.direction==='inbound')).toMatchObject({wa_message_id:input.key.id,org_id:a,device_id:device});scenarios.push({mode,inbound:1,executions:1,outbound:1,sends:1})
})
it('replays against actual restarted backend processes without execution or send duplication',async()=>{
 const input=event(),first=await replica();await first.run(input);expect(first.effects).toEqual({execute:1,send:1});first.stop()
 const restarted=await replica();await restarted.run(input);expect(restarted.effects).toEqual({execute:0,send:0});restarted.stop();expect(await rows(input.key.id)).toHaveLength(2);scenarios.push({mode:'actual process restart',inbound:1,executions:1,outbound:1,sends:1})
})
it('runs 10 concurrent deliveries against two actual backend processes once',async()=>{
 const [one,two]=await Promise.all([replica(),replica()]),input=event();await Promise.all(Array.from({length:10},(_,i)=>(i%2?one:two).run(input)))
 expect(one.effects.execute+two.effects.execute).toBe(1);expect(one.effects.send+two.effects.send).toBe(1);one.stop();two.stop();expect(await rows(input.key.id)).toHaveLength(2);scenarios.push({mode:'two actual processes, 10 concurrent',inbound:1,executions:1,outbound:1,sends:1})
})
it('same ID is independent across devices and organizations',async()=>{
 const input=event();await router().routeMessage(device,a,input);await router().routeMessage(secondDevice,a,input);await router().routeMessage(cDevice,c,input)
 expect(execute).toHaveBeenCalledTimes(3);expect(send).toHaveBeenCalledTimes(3);expect(await rows(input.key.id,a,secondDevice)).toHaveLength(2)
})
it('distinct IDs with identical content are never fingerprint-dropped',async()=>{
 await Promise.all([router().routeMessage(device,a,event()),router().routeMessage(device,a,event())]);expect(execute).toHaveBeenCalledTimes(2);expect(send).toHaveBeenCalledTimes(2)
})
it('missing IDs, own echoes and foreign device contexts cause no persistence or effects',async()=>{
 const count=(await admin.from('message_receipts').select('*').eq('org_id',a)).data!.length
 await router().routeMessage(device,a,{...event(),key:{remoteJid:'971500001111@s.whatsapp.net'}})
 await router().routeMessage(device,a,{...event(),key:{...event().key,fromMe:true}})
 await router().routeMessage(bDevice,a,event());expect(execute).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect((await admin.from('message_receipts').select('*').eq('org_id',a)).data).toHaveLength(count)
})
it('unsupported media is persisted once and ignored without AI',async()=>{
 const input={...event(),message:{imageMessage:{caption:'Image caption'}}};await Promise.all(Array.from({length:10},()=>router().routeMessage(device,a,input)))
 expect(await rows(input.key.id)).toHaveLength(1);expect((await rows(input.key.id))[0].processing_status).toBe('ignored');expect(execute).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
})
it('a persisted received event resumes once and uses its saved content',async()=>{
 const saved=await received();await router().routeMessage(device,a,{...event(saved.wa_message_id),message:{conversation:'Forged duplicate content'}})
 expect(execute.mock.calls[0][0]).toMatchObject({message:'Hello saved response'});expect(execute).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1)
})
it('saved unsent responses resume concurrently without rerunning business logic',async()=>{
 const saved=await received(),token=(await persistence.claim(saved))!,outbound=new OutboundMessageService(admin,send);const response=await outbound.prepare(saved,token,'Saved before restart')
 await Promise.all([router().resumePending(device,a),router().resumePending(device,a)]);expect(execute).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toMatchObject({messageId:response.wa_message_id,text:'Saved before restart'});expect((await rows(saved.wa_message_id)).every(r=>r.processing_status==='completed')).toBe(true)
})
it('completed replay never re-executes registered business handlers',async()=>{
 const input=event(),custom=vi.fn(),r=router();r.registerHandler('text',custom);await Promise.all(Array.from({length:10},()=>r.routeMessage(device,a,input)));expect(custom).toHaveBeenCalledTimes(1)
})
it('a business-handler failure is quarantined instead of repeating side effects',async()=>{
 const input=event(),custom=vi.fn(async()=>{throw Error('Business effect interrupted')}),r=router();r.registerHandler('text',custom)
 await r.routeMessage(device,a,input);await r.routeMessage(device,a,input);expect(custom).toHaveBeenCalledTimes(1);expect(execute).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled();expect((await rows(input.key.id))[0]).toMatchObject({processing_status:'needs_review',failure_code:'EXECUTION_OUTCOME_UNKNOWN'})
})
it('ambiguous send failures retain one response and never send a fallback/retry',async()=>{
 const input=event();send.mockRejectedValue(Error('Timeout after possible remote acceptance'));await router().routeMessage(device,a,input);await router().routeMessage(device,a,input)
 expect(execute).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);const saved=await rows(input.key.id);expect(saved).toHaveLength(2);expect(saved.every(r=>r.processing_status==='needs_review')).toBe(true);expect(saved[0].failure_code).toBe('SEND_OUTCOME_UNKNOWN')
})
it('lost send acknowledgement never causes a second network attempt',async()=>{
 const saved=await received(),token=(await persistence.claim(saved))!
 const db=new Proxy(admin,{get(target,key){if(key==='rpc')return async(name:string,args:Record<string,unknown>)=>name==='finish_whatsapp_send'?{data:null,error:{code:'LOCAL_ACK_LOST'}}:target.rpc(name,args);return Reflect.get(target,key)}})
 const outbound=new OutboundMessageService(db,send),response=await outbound.prepare(saved,token,'Receipt interrupted');await expect(outbound.deliver(response)).rejects.toThrow('LOCAL_ACK_LOST')
 await router().routeMessage(device,a,event(saved.wa_message_id));expect(send).toHaveBeenCalledTimes(1);expect(execute).not.toHaveBeenCalled();expect((await rows(saved.wa_message_id)).find(r=>r.direction==='outbound').processing_status).toBe('sending')
})
it('a lost response-save acknowledgement resumes the committed reply without regeneration',async()=>{
 const saved=await received(),token=(await persistence.claim(saved))!
 const db=new Proxy(admin,{get(target,key){if(key==='rpc')return async(name:string,args:Record<string,unknown>)=>{const result=await target.rpc(name,args);return name==='prepare_whatsapp_response'&&!result.error?{data:null,error:{code:'LOCAL_SAVE_ACK_LOST'}}:result};return Reflect.get(target,key)}})
 await expect(new OutboundMessageService(db,send).prepare(saved,token,'Committed before lost acknowledgement')).rejects.toThrow('LOCAL_SAVE_ACK_LOST')
 await router().routeMessage(device,a,event(saved.wa_message_id));expect(execute).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].text).toBe('Committed before lost acknowledgement')
})
it('a mismatched transport receipt is uncertain and cannot redirect the saved device',async()=>{
 send.mockImplementationOnce(async input=>({deviceId:secondDevice,messageId:input.messageId}))
 const input=event();await router().routeMessage(device,a,input);await router().routeMessage(device,a,input)
 expect(send).toHaveBeenCalledTimes(1);expect((await rows(input.key.id)).every(r=>r.processing_status==='needs_review')).toBe(true)
})
it('recovery drains more than one REST batch without skipping saved responses',async()=>{
 const saved=await received(),inbound=Array.from({length:105},()=>({id:randomUUID(),org_id:a,device_id:device,conversation_id:saved.conversation_id,direction:'inbound',sender_type:'contact',content:'Backlog fixture',wa_message_id:randomUUID(),processing_status:'prepared'}))
 await insert('messages',inbound)
 await insert('messages',inbound.map(m=>({...m,id:randomUUID(),direction:'outbound',sender_type:'ai',wa_message_id:randomUUID(),reply_to_message_id:m.id,metadata:{replyJid:'971500009999@s.whatsapp.net'}})))
 await router().resumePending(device,a);expect(send).toHaveBeenCalledTimes(105);expect(execute).not.toHaveBeenCalled()
 const pending=await admin.from('messages').select('id').eq('org_id',a).eq('device_id',device).eq('direction','outbound').eq('processing_status','prepared');expect(pending.data).toEqual([])
})
it('lost execution claim never grants business processing to a replay',async()=>{
 const saved=await received();expect(await persistence.claim(saved)).toBeTruthy();await router().routeMessage(device,a,event(saved.wa_message_id));expect(execute).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(await rows(saved.wa_message_id)).toHaveLength(1)
})
it('one provider error saves and sends one localized fallback',async()=>{
 execute.mockRejectedValueOnce(Error('Provider unavailable'));const input=event();await router().routeMessage(device,a,input);await router().routeMessage(device,a,input);expect(execute).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].text).toContain('temporary issue');expect(await rows(input.key.id)).toHaveLength(2)
})
it('deleted logical message history retains its durable receipt and blocks replay',async()=>{
 const input=event(randomUUID(),'971500001234');await router().routeMessage(device,a,input);const first=(await rows(input.key.id)).find(r=>r.direction==='inbound')
 const deleted=await admin.from('conversations').delete().eq('org_id',a).eq('id',first.conversation_id);if(deleted.error)throw deleted.error
 await router().routeMessage(device,a,input);expect(execute).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1);expect(await rows(input.key.id)).toHaveLength(0);expect((await admin.from('message_receipts').select('*').eq('org_id',a).eq('wa_message_id',input.key.id)).data).toHaveLength(1)
})
it('deleting a device preserves its transport history and rejects later stale events',async()=>{
 const retired=randomUUID(),input=event();await insert('devices',{id:retired,org_id:a,name:'Retired fixture'});await router().routeMessage(retired,a,input)
 const removed=await admin.from('devices').delete().eq('org_id',a).eq('id',retired);if(removed.error)throw removed.error
 expect(await rows(input.key.id,a,retired)).toHaveLength(2)
 expect((await admin.from('message_receipts').select('*').eq('org_id',a).eq('device_id',retired)).data).toHaveLength(1)
 await router().routeMessage(retired,a,input);expect(execute).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledTimes(1)
})
it('new duplicate inbound/outbound writes and foreign device/reply links fail at the database',async()=>{
 const input=event();await router().routeMessage(device,a,input);const saved=await rows(input.key.id),inbound=saved.find(r=>r.direction==='inbound'),outbound=saved.find(r=>r.direction==='outbound')
 const clone={...inbound,id:randomUUID()};expect((await admin.from('messages').insert(clone)).error?.code).toBe('23505')
 expect((await admin.from('messages').insert({...outbound,id:randomUUID(),wa_message_id:randomUUID()})).error?.code).toBe('23505')
 expect((await admin.from('messages').insert({...clone,device_id:bDevice,wa_message_id:randomUUID()})).error?.code).toBe('23503')
 expect((await admin.from('messages').insert({...clone,conversation_id:bConversation,wa_message_id:randomUUID()})).error?.code).toBe('23503')
 expect((await admin.from('messages').insert({...outbound,id:randomUUID(),org_id:b,device_id:bDevice,conversation_id:bConversation,wa_message_id:randomUUID()})).error?.code).toBe('23503')
})
it('preserves historical duplicate IDs and suppresses replay where the old device is explicit',async()=>{
 const result=await persistence.receive({orgId:stack.phase4UpgradeOrg,deviceId:stack.phase5HistoricalDevice,waMessageId:'legacy-duplicate',jid:'400000001@s.whatsapp.net',phone:'400000001',content:'Historical replay',type:'text'})
 expect(result.processing_status).toBe('ignored');expect(await persistence.claim(result)).toBeNull()
 const historical=await admin.from('messages').select('*').eq('org_id',stack.phase4UpgradeOrg).eq('wa_message_id','legacy-duplicate');expect(historical.data).toHaveLength(2);expect(historical.data!.every(r=>r.device_id===null&&r.processing_status===null)).toBe(true)
})
it('stale or foreign claim tokens cannot prepare, finalize or stop another execution',async()=>{
 const saved=await received(),token=(await persistence.claim(saved))!
 await expect(new OutboundMessageService(admin,send).prepare(saved,randomUUID(),'Forged result')).rejects.toThrow('PT409')
 expect(await persistence.rpc('claim_whatsapp_execution',{p_org_id:b,p_device_id:device,p_message_id:saved.id,p_token:randomUUID()})).toBeNull()
 await expect(persistence.stop(saved,randomUUID(),true,null)).rejects.toThrow('claim lost')
 const response=await new OutboundMessageService(admin,send).prepare(saved,token,'Owned result')
 expect(await persistence.rpc('finish_whatsapp_send',{p_org_id:a,p_device_id:device,p_message_id:response.id,p_token:randomUUID(),p_success:true,p_failure_code:null})).toBe(false)
})
it('anon and authenticated roles cannot call transport RPCs or tamper with transport rows',async()=>{
 const saved=await received(),base={p_org_id:a,p_device_id:device,p_message_id:saved.id,p_token:randomUUID()}
 const calls:[string,Record<string,unknown>][]=[['receive_whatsapp_message',{p_org_id:a,p_device_id:device,p_wa_message_id:randomUUID(),p_jid:'971500009999@s.whatsapp.net',p_phone:'971500009999',p_name:null,p_content:'Attempt',p_type:'text'}],['claim_whatsapp_execution',base],['prepare_whatsapp_response',{...base,p_text:'Attempt',p_outbound_wa_id:randomUUID(),p_metadata:{},p_match_metadata:{}}],['claim_whatsapp_send',base],['finish_whatsapp_send',{...base,p_success:true,p_failure_code:null}],['stop_whatsapp_execution',{...base,p_ignored:true,p_failure_code:null}]]
 for(const credential of [null,token,bToken]){
  const client=createClient(stack.url,stack.anonKey,{auth:{persistSession:false},global:{headers:credential?{authorization:'Bearer '+credential}:{}}})
  for(const[name,args]of calls)expect((await client.rpc(name,args)).error?.code).toBe('42501')
  expect((await client.from('message_receipts').select('*')).error?.code).toBe('42501')
  if(credential===token){
   const before=(await admin.from('messages').select('*').eq('id',saved.id).single()).data
   // 031 revokes browser write privileges before RLS filtering can yield an empty result.
   expect((await client.from('messages').update({processing_status:'completed'}).eq('id',saved.id).select('id')).error?.code).toBe('42501')
   expect((await client.from('messages').delete().eq('id',saved.id).select('id')).error?.code).toBe('42501')
   expect((await admin.from('messages').select('*').eq('id',saved.id).single()).data).toEqual(before)
  }
 }
 const db=new pg.Client({connectionString:stack.dbUrl});await db.connect()
 try{
  for(const command of ['update public.messages set processing_status=\'completed\' where id=$1','delete from public.messages where id=$1']){
   await db.query('begin');await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({org_id:a})])
   await expect(db.query(command,[saved.id])).rejects.toMatchObject({code:'42501'});await db.query('rollback')
  }
 }finally{await db.query('rollback').catch(()=>{});await db.end()}
})
it('authenticated applications scope saved states and preserve foreign resource denials',async()=>{
 const input=event();await router().routeMessage(device,a,input);const own=(await rows(input.key.id)).find(r=>r.direction==='inbound')
 const back=await http('backend','/messages?conversationId='+own.conversation_id+'&org_id='+b);expect(back.status).toBe(200);expect(back.body.data.every((r:any)=>r.org_id===a)).toBe(true)
 const front=await http('frontend','/conversations/'+own.conversation_id+'?orgId='+b);expect(front.status).toBe(200);expect(front.body.data.messages.every((r:any)=>r.orgId===a)).toBe(true)
 expect((await http('backend','/messages?conversationId='+bConversation)).status).toBe(404);expect((await http('frontend','/conversations/'+bConversation)).status).toBe(404)
 const outbound=(await rows(input.key.id)).find(r=>r.direction==='outbound');expect((await http('frontend','/v1/messages/'+outbound.id,'DELETE')).status).toBe(409);expect((await http('frontend','/v1/messages/'+outbound.id,'DELETE',bToken)).status).toBe(404)
})
it('shows clear delivery review in the actual inbox without a misleading sent tick',async()=>{
 const input={...event(randomUUID(),'971500004444'),pushName:'Delivery review fixture'};send.mockRejectedValue(Error('Fixture uncertain'));await router().routeMessage(device,a,input)
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'sb-access-token',value:token,url:frontendUrl}]);const page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message))
 await page.goto(frontendUrl+'/inbox');await page.getByText('Delivery review fixture',{exact:true}).first().click();await browserExpect(page.getByRole('status').filter({hasText:'Delivery needs review'})).toBeVisible();await browserExpect(page.getByText('Check delivery before sending again.').first()).toBeVisible();await page.screenshot({path:resolve(process.env.PHASE_TRANSPORT_REPORT_DIR ?? 'docs/phase5/artifacts/transport','delivery-review-desktop.png'),fullPage:true});expect(browserErrors).toEqual([]);await context.close()
})
