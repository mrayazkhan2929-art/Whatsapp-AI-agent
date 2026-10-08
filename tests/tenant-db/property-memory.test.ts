import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest'
import {chromium,expect as browserExpect,type Browser} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawn,type ChildProcess} from 'node:child_process'
import type {Server} from 'node:http'
import {createApiApp} from '../../backend/src/api/app'
import {MessageRouter} from '../../backend/src/whatsapp/MessageRouter'
import {defaultAgentConfig} from '../../backend/src/modules/config/AgentVersionService'
import {ConversationStateService} from '../../backend/src/modules/contacts/ConversationStateService'

const external=vi.hoisted(()=>({send:vi.fn(async(_input:{text:string})=>({deviceId:(_input as any).deviceId,messageId:(_input as any).messageId ?? randomUUID()})),provider:vi.fn(()=>{throw Error('Property reply must not call a provider')})}))
vi.mock('@anthropic-ai/sdk',()=>({default:class{messages={create:external.provider}}}))
vi.mock('groq-sdk',()=>({default:class{chat={completions:{create:external.provider}}}}))
vi.mock('../../backend/src/whatsapp/WhatsAppGateway',()=>({whatsAppGateway:{sendText:external.send,getConnectedDeviceIds:()=>[],getRuntimeSnapshotSummary:()=>({}),getRuntimeSnapshot:()=>null,normalizeDeviceStatus:(s:string)=>s,getTransportHealth:()=>null}}))
vi.mock('../../backend/src/api/middleware/rateLimit',()=>({apiRateLimit:(_r:unknown,_s:unknown,next:()=>void)=>next()}))
const stack=JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!,'utf8'))
const admin=createClient(stack.url,stack.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const a=randomUUID(),b=randomUUID(),bContact=randomUUID(),bConversation=randomUUID(),device=randomUUID()
const tables=['organizations','users','properties','property_media','contacts','contact_memory','conversations','conversation_states','messages','inventory_gaps','agents','agent_versions','agent_drafts','agent_config_events','agent_channel_links']
let server:Server,next:ChildProcess,browser:Browser,backendUrl:string,frontendUrl:string,token:string,bToken:string,upgradeToken:string,beforeB:unknown
let requests=0,snapshots=0,externalRequests=0,exactAssertions=0
const output=resolve(process.env.PHASE_PROPERTY_REPORT_DIR ?? 'docs/phase4/artifacts/properties'),logs:string[]=[],browserErrors:string[]=[]
const properties=Array.from({length:7},(_,i)=>({id:randomUUID(),org_id:a,ref:`A-PROP-${i+1}`,ref_number:`A-ALIAS-${i+1}`,type:'apartment',category:'sale',transaction_type:'SALE',district:'Dubai Marina',building:'Tower One',project:'Harbour',developer:'Builder',bedrooms:'2',status:'ready',price_aed:1000000+i*100000,image_urls:[`https://cdn.example.invalid/a-${i+1}.jpg`]}))
async function insert(table:string,data:unknown){const result=await admin.from(table).insert(data as any);if(result.error)throw result.error}
async function identity(name:string,orgId:string){
  const email=name+'@phase4.example.invalid',password='Phase4-local-fixture-123!'
  const user=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{org_id:b}});if(user.error)throw user.error
  await insert('users',{id:user.data.user.id,org_id:orgId,email,name,role:'admin',password_hash:'local-fixture',active:true})
  const client=createClient(stack.url,stack.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
  const signed=await client.auth.signInWithPassword({email,password});if(signed.error)throw signed.error
  return signed.data.session!.access_token
}
async function call(surface:'backend'|'frontend',path:string,method='GET',body?:unknown,credential=token){
  requests++;const result=await fetch((surface==='backend'?backendUrl+'/api/v1':frontendUrl+'/api')+path,{method,headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  return {status:result.status,body:await result.json()}
}
async function chat(surface:'backend'|'frontend',message:string,conversationId?:string,extras:Record<string,unknown>={}){
  const result=await call(surface,'/chat','POST',{message,conversationId,...extras});expect(result.status,JSON.stringify(result.body)).toBe(200);return result.body
}
async function conversation(legacy?:Record<string,unknown>){
  const contactId=randomUUID(),id=randomUUID();await insert('contacts',{id:contactId,org_id:a,phone:'+4'+Date.now()+Math.floor(Math.random()*1e6),contact_memory:legacy ?? {}})
  await insert('conversations',{id,org_id:a,contact_id:contactId});return {id,contactId}
}
async function snapshotB(){
  const data:Record<string,unknown>={}
  for(const table of tables){let query=admin.from(table).select('*');query=table==='contact_memory'?query.eq('contact_id',bContact):query.eq(table==='organizations'?'id':'org_id',b);const result=await query;if(result.error)throw result.error;data[table]=result.data}
  return data
}
beforeAll(async()=>{
  const native=globalThis.fetch
  vi.stubGlobal('fetch',(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname)){externalRequests++;throw Error('Non-local network blocked')}return native(input,init)})
  await insert('organizations',[{id:a,name:'Property Tenant A',slug:'phase4-a'},{id:b,name:'Property Tenant B sentinel',slug:'phase4-b'}])
  token=await identity('property-a',a);bToken=await identity('property-b',b);upgradeToken=await identity('property-upgrade',stack.phase4UpgradeOrg)
  await insert('properties',[...properties,{id:randomUUID(),org_id:a,ref:'A-VILLA-1',type:'villa',category:'sale',district:'Dubai Marina',bedrooms:'2',price_aed:1000000},
    {id:randomUUID(),org_id:a,ref:'A-PARTNER-1',type:'apartment',category:'sale',district:'Dubai Marina',bedrooms:'2',price_aed:1700000,source:'indirect'},
    {id:randomUUID(),org_id:a,ref:'A-EMPTY-1',district:'Unknown recorded area',price_aed:0},
    {id:randomUUID(),org_id:b,ref:'B-PRIVATE-1',type:'apartment',category:'sale',district:'Dubai Marina',bedrooms:'2',price_aed:1,description:'B SECRET SENTINEL'},
    {id:randomUUID(),org_id:b,ref:'A-PROP-1',district:'Private B area',price_aed:42},
    {id:randomUUID(),org_id:a,ref:'A/UNIT-101',ref_number:'A/ALIAS-101',district:'Complex Area',type:'villa',price_aed:111},
    {id:randomUUID(),org_id:a,ref:'UNIT-101',ref_number:'SHORT-101',district:'Complex Area',type:'apartment',price_aed:222}].map(p=>({source:'direct',image_urls:[],...p})))
  await insert('contacts',{id:bContact,org_id:b,phone:'+400000002',contact_memory:{area:'B PRIVATE'}})
  await insert('conversations',{id:bConversation,org_id:b,contact_id:bContact})
  const bSaved=await admin.rpc('save_conversation_state',{p_org_id:b,p_conversation_id:bConversation,p_contact_id:bContact,p_expected_revision:0,p_criteria:{area:'B PRIVATE',excludeRefs:[]},p_shown_refs:[],p_language:'en'});if(bSaved.error)throw bSaved.error
  const bProperty=(await admin.from('properties').select('id').eq('org_id',b).eq('ref','B-PRIVATE-1').single()).data!
  await insert('property_media',[{org_id:a,property_id:properties[0].id,media_type:'brochure',url:'https://cdn.example.invalid/brochure.pdf'},
    {org_id:a,property_id:properties[0].id,media_type:'image',url:'https://127.0.0.1/private'},
    {org_id:b,property_id:bProperty.id,media_type:'image',url:'https://b.example.invalid/private.jpg'}])
  await insert('devices',{id:device,org_id:a,name:'Property channel'})
  server=await new Promise<Server>(done=>{const listener=createApiApp(0).listen(0,'127.0.0.1',()=>done(listener))});backendUrl='http://127.0.0.1:'+(server.address() as {port:number}).port
  next=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','-p','0','-H','127.0.0.1'],{cwd:resolve('frontend'),env:{...process.env,NODE_ENV:'production',BACKEND_URL:backendUrl},stdio:['ignore','pipe','pipe'],windowsHide:true})
  await new Promise<void>((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Next startup timeout')),60000);const read=(chunk:Buffer)=>{const text=chunk.toString();logs.push(text);const url=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(url)frontendUrl=url[0];if(/Ready in/.test(text)){clearTimeout(timeout);done()}};next.stdout!.on('data',read);next.stderr!.on('data',read);next.on('exit',code=>{clearTimeout(timeout);reject(Error('Next exit '+code))})})
  const created=await call('backend','/agents','POST',{name:'Property assistant',config:defaultAgentConfig('Property assistant')});expect(created.status).toBe(201)
  const agentId=created.body.data.id,revision={expectedRevision:1,expectedPublishedVersionId:null}
  expect((await call('backend',`/agents/${agentId}/test`,'POST',revision)).status).toBe(200)
  expect((await call('backend',`/agents/${agentId}/publish`,'POST',revision)).status).toBe(200)
  expect((await call('backend',`/agents/${agentId}/channels`,'POST',{deviceId:device})).status).toBe(200)
  process.env.ANTHROPIC_API_KEY='phase4-local-stub-only'
  mkdirSync(output,{recursive:true});browser=await chromium.launch({headless:true})
})
beforeEach(async()=>{beforeB=await snapshotB();external.send.mockClear();external.provider.mockClear()})
afterEach(async()=>{expect(await snapshotB()).toEqual(beforeB);expect(externalRequests).toBe(0);expect(external.provider).not.toHaveBeenCalled();snapshots++;writeFileSync(resolve(stack.directory,'property-progress.json'),JSON.stringify({completed:snapshots,requests,exactAssertions}))})
afterAll(async()=>{
  await browser?.close();next?.kill();if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()))}
  writeFileSync(resolve(stack.directory,'property-http-evidence.json'),JSON.stringify({requests,tenantBSnapshotChecks:snapshots,snapshotTables:tables,exactReferenceAssertions:exactAssertions,externalRequests,browserErrors,providerAndWhatsApp:'stubbed; provider configured with a local dummy key and no calls expected',appliedToLiveProject:false},null,2));writeFileSync(resolve(stack.directory,'property-frontend.log'),logs.join(''));delete process.env.ANTHROPIC_API_KEY;vi.unstubAllGlobals()
})
describe.each(['backend','frontend'] as const)('%s property and conversation boundary',surface=>{
  it('returns the requested exact identity across canonical and legacy references',async()=>{
    for(const p of properties)for(const ref of [p.ref,p.ref_number,p.ref.toLowerCase()]){const result=await chat(surface,'Send me property reference: '+ref);expect(result.shownPropertyRefs).toEqual([p.ref_number]);expect(result.reply).toContain(p.price_aed.toLocaleString('en-AE'));expect(result.matchQuality).toBe('exact');exactAssertions++}
  })
  it('denies foreign state, property and media and never substitutes an exact miss',async()=>{
    for(const path of ['/conversations/'+bConversation+'/state','/properties/B-PRIVATE-1','/properties/B-PRIVATE-1/media'])expect((await call(surface,path)).status).toBe(404)
    expect((await call(surface,'/chat','POST',{conversationId:bConversation,message:'Show properties'})).status).toBe(404)
    for(const ref of ['B-PRIVATE-1','NOT-FOUND-999']){const result=await chat(surface,'reference: '+ref);expect(result.shownPropertyRefs).toEqual([]);expect(result.matchedProperties).toBe(0);expect(result.reply).not.toContain('AED');exactAssertions++}
    const own=await chat(surface,'reference: A-PROP-1');expect(own.reply).not.toContain('Private B');expect(own.reply).not.toContain('AED 42')
  })
  it('keeps compound references intact instead of substituting a matching suffix',async()=>{
    for(const message of ['Send property A/UNIT-101','reference: A/UNIT-101','reference: A/ALIAS-101']){
      const result=await chat(surface,message);expect(result.shownPropertyRefs).toEqual(['A/ALIAS-101']);expect(result.reply).toContain('AED 111');expect(result.reply).not.toContain('AED 222');exactAssertions++
    }
    expect((await call(surface,'/properties/'+encodeURIComponent('A/UNIT-101'))).status).toBe(200)
  })
  it('ignores forged organization IDs and retains server-owned state',async()=>{
    const c=await conversation();const result=await chat(surface,'2BR apartment in Marina under 2M',c.id,{org_id:b,orgId:b,criteria:{area:'B PRIVATE'}})
    expect(result.shownPropertyRefs.length).toBe(3);expect(JSON.stringify(result)).not.toContain('B SECRET')
    const state=await call(surface,`/conversations/${c.id}/state?orgId=${b}&org_id=${b}`);expect(state.status).toBe(200);expect(state.body.data.criteria).toMatchObject({area:'Dubai Marina',bedrooms:'2',propertyType:'apartment',maxPrice:2000000})
  })
  it('retains area, bedrooms and budget across three persisted turns without repetition',async()=>{
    const c=await conversation(),first=await chat(surface,'I need a 2BR apartment in Marina',c.id),second=await chat(surface,'Max 2 million',c.id),third=await chat(surface,'Show me more',c.id)
    const refs=[...first.shownPropertyRefs,...second.shownPropertyRefs,...third.shownPropertyRefs];expect(new Set(refs).size).toBe(refs.length);expect(refs.length).toBe(7)
    const state=await call(surface,`/conversations/${c.id}/state`);expect(state.body.data).toMatchObject({revision:3,criteria:{area:'Dubai Marina',bedrooms:'2',maxPrice:2000000}})
    const direct=await new ConversationStateService().read(a,c.id,c.contactId);expect(direct.criteria.maxPrice).toBe(2000000)
    const json=(await admin.from('contacts').select('contact_memory').eq('id',c.contactId).single()).data!.contact_memory;expect(json).toMatchObject({area:'Dubai Marina',bedrooms:'2',maxBudget:2000000})
    const rows=(await admin.from('contact_memory').select('key,value').eq('contact_id',c.contactId)).data!;expect(rows.find(r=>r.key==='maxBudget')?.value).toBe('2000000')
  })
  it('extracts Arabic and mixed requests with the same constraints as English',async()=>{
    const en=await chat(surface,'buy a 2BR apartment in Marina under 2M'),ar=await chat(surface,'أريد شراء شقة غرفتين في دبي مارينا بميزانية أقل من ٢ مليون درهم'),mixed=await chat(surface,'شراء apartment 2BR في Marina بميزانية ۲ مليون')
    expect(ar.language).toBe('ar');expect(ar.shownPropertyRefs).toEqual(en.shownPropertyRefs);expect(mixed.shownPropertyRefs).toEqual(en.shownPropertyRefs)
  })
  it.each(['3BR apartment in Marina','apartment in Marina under AED 900k','apartment in Marina above AED 4M','ready apartment project: Different','apartment building: Tower','apartment developer: Different','off-plan apartment in Marina','distress apartment in Marina'])('does not relax %s',async message=>{
    const result=await chat(surface,message);expect(result.shownPropertyRefs).toEqual([]);expect(result.matchQuality).toBe('none');expect(result.reply).not.toContain('AED')
  })
  it('preserves exact project/building and property type separately from transaction',async()=>{
    const result=await chat(surface,'buy 2BR apartment project: Harbour; building: Tower One; developer: Builder')
    expect(result.shownPropertyRefs).toHaveLength(3);expect(result.reply).toContain('Harbour');expect(result.reply).not.toContain('villa')
    expect((await chat(surface,'2BR villa in Marina under 2M')).shownPropertyRefs).toEqual(['A-VILLA-1'])
  })
  it('excludes all prior options through partner fallback and then gives an honest no-match',async()=>{
    const c=await conversation();const refs:string[]=[]
    for(let i=0;i<4;i++){const result=await chat(surface,i===0?'2BR apartment in Marina under 2M':'Do you have another option?',c.id);refs.push(...result.shownPropertyRefs)}
    expect(new Set(refs).size).toBe(8);expect(refs).toContain('A-PARTNER-1')
    const last=await chat(surface,'Show me more',c.id);expect(last.shownPropertyRefs).toEqual([]);expect(last.matchQuality).toBe('none')
  })
  it('uses recorded media for the current exact listing and suppresses unsafe URLs',async()=>{
    const c=await conversation();await chat(surface,'reference: A-PROP-1',c.id)
    const media=await chat(surface,'Send photos and brochure',c.id);expect(media.shownPropertyRefs).toEqual(['A-ALIAS-1']);expect(media.reply).toContain('https://cdn.example.invalid/a-1.jpg');expect(media.reply).toContain('brochure.pdf');expect(media.reply).not.toContain('127.0.0.1/private');expect(media.reply).not.toContain('b.example.invalid')
    const list=await call(surface,'/properties/A-ALIAS-1/media');expect(list.status).toBe(200);expect(list.body.data).toHaveLength(2)
  })
  it('moves from an exact listing to eligible alternatives when asked for more',async()=>{
    const c=await conversation();await chat(surface,'reference: A-PROP-1',c.id)
    const next=await chat(surface,'Show me more',c.id)
    expect(next.shownPropertyRefs).toHaveLength(3);expect(next.shownPropertyRefs).not.toContain('A-ALIAS-1')
    const state=await new ConversationStateService().read(a,c.id)
    expect(state.criteria).toMatchObject({area:'Dubai Marina',bedrooms:'2',propertyType:'apartment',transactionType:'SALE'})
    expect(state.criteria.referenceNumber).toBeUndefined()
    expect((await admin.from('contacts').select('contact_memory').eq('id',c.contactId).single()).data?.contact_memory).toMatchObject({transactionType:'SALE',intent:'buy'})
  })
  it('never invents missing bedrooms, agent, sale status or Dubai location',async()=>{
    const result=await chat(surface,'reference: A-EMPTY-1');expect(result.reply).toContain('AED 0');for(const text of ['Studio','For sale','Dubai','Team','Agent:'])expect(result.reply).not.toContain(text)
  })
  it('applies the next availability change without cache delay',async()=>{
    const changed=await admin.from('properties').update({available:false}).eq('id',properties[6].id);expect(changed.error).toBeNull()
    expect((await chat(surface,'reference: A-PROP-7')).shownPropertyRefs).toEqual([])
    await admin.from('properties').update({available:true}).eq('id',properties[6].id)
  })
  it('rejects contradictory budgets before writing conversation state',async()=>{
    const c=await conversation();expect((await call(surface,'/chat','POST',{conversationId:c.id,message:'2BR Marina between 2 and 1 million'})).status).toBe(400)
    expect((await admin.from('conversation_states').select('*').eq('conversation_id',c.id)).data).toEqual([])
  })
})
it('serializes concurrent first-turn state updates and reserves different options',async()=>{
  const c=await conversation(),responses=await Promise.all([chat('backend','2BR apartment in Marina under 2M',c.id),chat('backend','2BR apartment in Marina under 2M',c.id)])
  const refs=responses.flatMap(r=>r.shownPropertyRefs);expect(refs).toHaveLength(6);expect(new Set(refs).size).toBe(6);expect((await new ConversationStateService().read(a,c.id)).revision).toBe(2)
})
it('keeps WhatsApp follow-ups durable across new router instances',async()=>{
  const phone='+499000001',messages=['I need a 2BR apartment in Marina','Max 2 million','Show me more']
  for(const message of messages)await new MessageRouter().routeMessage(device,a,{key:{id:randomUUID(),remoteJid:phone.replace('+','')+'@s.whatsapp.net',fromMe:false},message:{conversation:message},pushName:'Local property fixture'} as any)
  expect(external.send).toHaveBeenCalledTimes(3)
  const contact=(await admin.from('contacts').select('id').eq('org_id',a).eq('phone',phone.replace('+','')).single()).data!
  const c=(await admin.from('conversations').select('id').eq('org_id',a).eq('contact_id',contact.id).single()).data!
  expect((await new ConversationStateService().read(a,c.id)).criteria).toMatchObject({area:'Dubai Marina',bedrooms:'2',maxPrice:2e6})
  const outbound=(await admin.from('messages').select('metadata').eq('org_id',a).eq('conversation_id',c.id).eq('direction','outbound')).data!
  expect(outbound).toHaveLength(3);expect(outbound.every(row=>typeof row.metadata.agentVersionId==='string')).toBe(true)
  expect(external.send.mock.calls.map(args=>args[0].text).join('\n')).not.toContain('B SECRET')
})
it('lazily backfills valid legacy memory without deleting unrelated values',async()=>{
  const c=await conversation({area:'Marina',bedrooms:'2',maxBudget:2e6,legacy_note:'Keep this'})
  expect((await chat('backend','Show me more',c.id)).shownPropertyRefs).toHaveLength(3)
  expect((await admin.from('contacts').select('contact_memory').eq('id',c.contactId).single()).data?.contact_memory.legacy_note).toBe('Keep this')
})
it('refuses ambiguous identities retained by the populated migration',async()=>{
  const result=await call('backend','/chat','POST',{message:'reference: ALIAS-DUP'},upgradeToken)
  expect(result.status).toBe(200);expect(result.body.shownPropertyRefs).toEqual([]);expect(result.body.reply).toContain('ambiguous')
  const properties=(await admin.from('properties').select('id').eq('org_id',stack.phase4UpgradeOrg)).data;expect(properties).toHaveLength(2)
})
it('protects server-only state/media tables and CAS RPC from direct authenticated access',async()=>{
  for(const credential of [token,undefined]){
    const client=createClient(stack.url,stack.anonKey,{...(credential?{global:{headers:{authorization:'Bearer '+credential}}}:{}),auth:{persistSession:false,autoRefreshToken:false}})
    for(const table of ['conversation_states','property_media'])expect((await client.from(table).select('*')).error?.code).toBe('42501')
    const rpc=await client.rpc('save_conversation_state',{p_org_id:b,p_conversation_id:bConversation,p_contact_id:bContact,p_expected_revision:1,p_criteria:{},p_shown_refs:[],p_language:'en'});expect(rpc.error?.code).toBe('42501')
  }
})
it('enforces composite media ownership and blocks new ambiguous aliases',async()=>{
  expect((await admin.from('property_media').insert({org_id:a,property_id:(await admin.from('properties').select('id').eq('org_id',b).eq('ref','B-PRIVATE-1').single()).data!.id,media_type:'image',url:'https://cdn.example.invalid/attack.jpg'})).error?.code).toBe('23503')
  expect((await admin.from('properties').insert({org_id:a,ref:'A-DUPLICATE-1',ref_number:'a-prop-1',district:'Marina',price_aed:1})).error?.code).toBe('23505')
  const attempts=await Promise.all([1,2].map(i=>admin.from('properties').insert({org_id:a,ref:'RACE-'+i,ref_number:'RACE-ALIAS',district:'Marina',price_aed:1})))
  expect(attempts.filter(r=>!r.error)).toHaveLength(1);expect(attempts.filter(r=>r.error?.code==='23505')).toHaveLength(1)
})
it('rejects mismatched state parents and stale CAS without changing either tenant',async()=>{
  const c=await conversation()
  const mismatch=await admin.rpc('save_conversation_state',{p_org_id:a,p_conversation_id:c.id,p_contact_id:bContact,p_expected_revision:0,p_criteria:{area:'B PRIVATE'},p_shown_refs:[],p_language:'en'})
  expect(mismatch.error?.code).toBe('P0002')
  expect((await admin.from('conversation_states').insert({org_id:b,contact_id:bContact,conversation_id:c.id})).error?.code).toBe('PT404')
  expect((await admin.from('conversation_states').insert({org_id:a,contact_id:bContact,conversation_id:c.id})).error?.code).toBe('PT404')
  await chat('backend','2BR apartment in Marina',c.id)
  const before=await new ConversationStateService().read(a,c.id)
  await expect(new ConversationStateService().save(a,{...before,revision:0},{area:'Wrong',excludeRefs:[]},[],'en')).rejects.toMatchObject({status:409})
  expect(await new ConversationStateService().read(a,c.id)).toEqual(before)
})
it('finds an exact identity beyond the REST page size and supports explicit new areas',async()=>{
  const rows=Array.from({length:1005},(_,i)=>({id:'eeeeeeee-eeee-4eee-8eee-'+(i+1).toString(16).padStart(12,'0'),org_id:a,ref:'PAGE-'+(i+1),district:'Pagination Area',type:'penthouse',bedrooms:'2',price_aed:999}))
  await insert('properties',rows)
  const exact=await chat('backend','reference: PAGE-1005');expect(exact.shownPropertyRefs).toEqual(['PAGE-1005']);exactAssertions++
  const search=await chat('backend','2BR penthouse area: Pagination Area');expect(search.shownPropertyRefs).toHaveLength(3)
  expect((await call('frontend','/properties/PAGE-1005')).body.data.refNumber).toBe('PAGE-1005')
})
it.each([1280,390])('shows the calm property workspace and owned media at %i px',async width=>{
  const context=await browser.newContext({viewport:{width,height:900}});await context.addCookies([{name:'sb-access-token',value:token,url:frontendUrl}]);const page=await context.newPage();page.on('pageerror',error=>browserErrors.push(error.message))
  await page.goto(frontendUrl+'/properties/A-ALIAS-1');await browserExpect(page.getByRole('heading',{name:'Listing media'})).toBeVisible();await browserExpect(page.getByRole('link',{name:/Open brochure/})).toBeVisible();await browserExpect(page.getByText('apartment in Dubai Marina')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.screenshot({path:resolve(output,`property-${width===390?'mobile':'desktop'}.png`),fullPage:true});expect(browserErrors).toEqual([]);await context.close()
})
