import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest'
import {createClient} from '@supabase/supabase-js'
import {chromium,expect as browserExpect,type Browser,type BrowserContext,type Page} from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawn,type ChildProcess} from 'node:child_process'
import type {Server} from 'node:http'
import pg from 'pg'
import {createApiApp} from '../../backend/src/api/app'
import {MessageRouter} from '../../backend/src/whatsapp/MessageRouter'

const effects=vi.hoisted(()=>({connected:new Set<string>(),connect:vi.fn(),disconnect:vi.fn(),send:vi.fn(async(input:any)=>({deviceId:input.deviceId,messageId:input.messageId??randomUUID()})),provider:vi.fn(async()=>({content:[{type:'text',text:'Please share your property requirements.'}]})),batch:vi.fn(async(texts:string[])=>texts.map(()=>[1,...Array(1535).fill(0)]))}))
vi.mock('../../backend/src/whatsapp/WhatsAppGateway',()=>({whatsAppGateway:{sendText:effects.send,connectDevice:effects.connect,disconnectDevice:effects.disconnect,getConnectedDeviceIds:()=>[...effects.connected],getRuntimeSnapshotSummary:()=>({}),getRuntimeSnapshot:(id:string)=>effects.connected.has(id)?{status:'connected',connected:true,health:null}:null,normalizeDeviceStatus:(status:string)=>status,getTransportHealth:()=>null}}))
vi.mock('@anthropic-ai/sdk',()=>({default:class{messages={create:effects.provider}}}))
vi.mock('groq-sdk',()=>({default:class{chat={completions:{create:effects.provider}}}}))
vi.mock('../../backend/src/rag/EmbeddingService',()=>({EmbeddingService:{embedBatch:effects.batch,embed:async()=>[1,...Array(1535).fill(0)],isAvailable:()=>true,valid:(v:number[])=>Array.isArray(v)&&v.length===1536&&v.every(Number.isFinite)&&v.some(n=>n!==0)}}))
// Rate limiting is exercised separately, without starving this large acceptance flow.
vi.mock('../../backend/src/api/middleware/rateLimit',()=>({apiRateLimit:(_r:unknown,_s:unknown,n:()=>void)=>n()}))

const stack=JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!,'utf8')),admin=createClient(stack.url,stack.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}),sql=new pg.Client({connectionString:stack.dbUrl})
const a=randomUUID(),b=randomUUID(),bContact=randomUUID(),bDevice=randomUUID(),aContact=randomUUID(),aConversation=randomUUID(),bConversation=randomUUID()
const manualReview=process.env.PHASE11_MANUAL_REVIEW==='1'
const output=manualReview?resolve(stack.directory,'manual-artifacts'):resolve('docs/phase11/artifacts/hardening'),password='Phase11-local-password-123!'
let server:Server,next:ChildProcess,browser:Browser,backendUrl:string,frontendUrl:string,token:string,viewer:string,actor:string,tenantTables:string[],beforeB:unknown
let workspace:string,newToken:string,agent:string,device:string,context:BrowserContext,page:Page
let requests=0,bChecks=0,external=0
const browserErrors:string[]=[],logs:string[]=[],checks:unknown[]=[],workflow:string[]=[],accessibility:unknown[]=[]
async function insert(table:string,data:unknown){const result=await admin.from(table).insert(data as any);if(result.error)throw result.error}
async function identity(label:string,org?:string,role='owner',confirmed=true){const email=label+'@phase11.example.invalid',result=await admin.auth.admin.createUser({email,password,email_confirm:confirmed,app_metadata:{org_id:b,role:'owner'},user_metadata:{org_id:b}});if(result.error)throw result.error;if(org)await insert('users',{id:result.data.user.id,org_id:org,email,name:label,role,active:true,password_hash:'local-fixture'});const login=confirmed?await createClient(stack.url,stack.anonKey,{auth:{persistSession:false}}).auth.signInWithPassword({email,password}):null;if(login?.error)throw login.error;return{id:result.data.user.id,email,token:login?.data.session?.access_token}}
async function http(surface:'backend'|'frontend',path:string,method='GET',body?:unknown,credential=token){requests++;const response=await fetch((surface==='backend'?backendUrl+'/api/v1':frontendUrl+'/api')+path,{method,headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json(),headers:response.headers}}
async function snapshotB(){const state:Record<string,unknown>={};for(const table of tenantTables){const result=await sql.query(`SELECT to_jsonb(t)::text row FROM public."${table}" t WHERE org_id=$1 ORDER BY to_jsonb(t)::text`,[b]);state[table]=result.rows}state.organizations=(await sql.query('SELECT to_jsonb(o)::text row FROM organizations o WHERE id=$1',[b])).rows;state.contact_memory=(await sql.query('SELECT to_jsonb(m)::text row FROM contact_memory m JOIN contacts c ON c.id=m.contact_id WHERE c.org_id=$1 ORDER BY m.id',[b])).rows;return state}
async function rlsOrg(identityId:string,forgedOrg=b){await sql.query('BEGIN');try{await sql.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:identityId,role:'authenticated',org_id:forgedOrg,email:'forged@invalid'})]);await sql.query('SET LOCAL ROLE authenticated');return(await sql.query('SELECT public.current_org_id() org')).rows[0].org}finally{await sql.query('ROLLBACK')}}
beforeAll(async()=>{
  const nativeFetch=globalThis.fetch;vi.stubGlobal('fetch',(input:string|URL|Request,init?:RequestInit)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname)){external++;throw Error('External test request blocked')}return nativeFetch(input,init)})
  await sql.connect();mkdirSync(output,{recursive:true})
  await insert('organizations',[{id:a,name:'Security A',slug:'phase11-security-a'},{id:b,name:'Security B',slug:'phase11-security-b'}])
  const own=await identity('security-owner',a);token=own.token!;actor=own.id;viewer=(await identity('security-viewer',a,'viewer')).token!
  await insert('contacts',[{id:aContact,org_id:a,phone:'+6111111'},{id:bContact,org_id:b,phone:'+6222222',name:'PRIVATE TENANT B'}]);await insert('devices',{id:bDevice,org_id:b,name:'PRIVATE B DEVICE'})
  await insert('conversations',[{id:aConversation,org_id:a,contact_id:aContact},{id:bConversation,org_id:b,contact_id:bContact}])
  await insert('messages',[{org_id:a,conversation_id:aConversation,direction:'inbound',content:'Own inbox row'},{org_id:b,conversation_id:bConversation,direction:'inbound',content:'PRIVATE TENANT B MESSAGE'}])
  tenantTables=(await sql.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname")).rows.map(r=>String(r.relname))
  effects.connect.mockImplementation(async(id:string,org:string)=>{const r=await admin.from('devices').update({status:'connecting',qr_code:'phase11-local-qr-only'}).eq('id',id).eq('org_id',org);if(r.error)throw r.error;return{status:'connecting',connected:false,health:null}})
  effects.disconnect.mockImplementation(async(id:string,org:string)=>{const r=await admin.from('devices').update({status:'disconnected',qr_code:null}).eq('id',id).eq('org_id',org);if(r.error)throw r.error;effects.connected.delete(id);return{status:'disconnected',connected:false,health:null}})
  server=await new Promise<Server>(done=>{const s=createApiApp(0).listen(0,'127.0.0.1',()=>done(s))});backendUrl='http://127.0.0.1:'+(server.address() as {port:number}).port
  next=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','-p',String(stack.reviewFrontendPort??0),'-H','127.0.0.1'],{cwd:resolve('frontend'),env:{...process.env,NODE_ENV:'production',BACKEND_URL:backendUrl},stdio:['ignore','pipe','pipe'],windowsHide:true})
  await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(Error('Next startup timed out')),60000);const read=(data:Buffer)=>{const text=data.toString();logs.push(text);const url=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(url)frontendUrl=url[0];if(/Ready in/.test(text)){clearTimeout(timer);done()}};next.stdout!.on('data',read);next.stderr!.on('data',read);next.on('exit',code=>{clearTimeout(timer);reject(Error('Next exited '+code))})})
  browser=await chromium.launch({headless:true})
})
beforeEach(async()=>{beforeB=await snapshotB()})
afterEach(async()=>{expect(await snapshotB()).toEqual(beforeB);expect(external).toBe(0);bChecks++})
afterAll(async()=>{
  await context?.close();await browser?.close()
  const evidence={requests,tenantBSnapshotChecks:bChecks,tenantTables,externalRequests:external,browserErrors,checks,workflow,accessibility,whatsappTransport:'local stub only',embeddings:'local stub only',liveValidation:false}
  writeFileSync(resolve(output,'evidence.json'),JSON.stringify(evidence,null,2));writeFileSync(resolve(output,'frontend.log'),logs.join(''))
  if(manualReview){
    const stopFile=resolve('test-results/phase11-review.stop');if(existsSync(stopFile))unlinkSync(stopFile)
    writeFileSync(resolve('test-results/phase11-local-review.json'),JSON.stringify({frontendUrl,backendUrl,mailUrl:stack.mailUrl,stopFile,status:'running',localOnly:true,realWhatsapp:false,providerCalls:'stubbed',login:{email:'new-customer@phase11.example.invalid',password}},null,2))
    console.log('Local review available at '+frontendUrl+'; stop with node scripts/phase11-stop.mjs')
    const expires=Date.now()+11.5*60*60*1000
    while(!existsSync(stopFile)&&Date.now()<expires)await new Promise(done=>setTimeout(done,1000))
    writeFileSync(resolve('test-results/phase11-local-review.json'),JSON.stringify({status:'stopped',localOnly:true},null,2))
  }
  next?.kill();if(server){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()))}await sql.end();vi.unstubAllGlobals()
})

it('audits every public tenant table, view and application RPC privilege',async()=>{
  const relations:any[]=(await sql.query("SELECT c.relname,c.relkind,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') anon_read,has_table_privilege('authenticated',c.oid,'SELECT') user_read,has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') user_write FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e') ORDER BY c.relname")).rows
  for(const row of relations){expect(row.anon_read,row.relname).toBe(false);expect(row.user_write,row.relname).toBe(false);expect(row.user_read,row.relname).toBe(['messages','conversations'].includes(row.relname));if(row.relkind==='r')expect(row.relrowsecurity,row.relname).toBe(true)}
  const functions:any[]=(await sql.query("SELECT p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,has_function_privilege('authenticated',p.oid,'EXECUTE') user_exec FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') ORDER BY p.proname")).rows
  for(const row of functions){expect(row.anon_exec,row.proname).toBe(false);expect(row.user_exec,row.proname).toBe(['current_org_id','visible_inbox_parent','visible_message_device'].includes(row.proname));if(row.prosecdef)expect(row.proconfig?.some((v:string)=>v.startsWith('search_path=')),row.proname).toBe(true)}
  writeFileSync(resolve(output,'rls-inventory.json'),JSON.stringify({relations,functions},null,2));checks.push({rlsTables:relations.filter(r=>r.relkind==='r').length,views:relations.filter(r=>r.relkind==='v').length,applicationFunctions:functions.length})
})
it('RLS uses direct membership and ignores forged tenant claims and metadata',async()=>{
  expect(await rlsOrg(actor)).toBe(a)
  const client=createClient(stack.url,stack.anonKey,{auth:{persistSession:false},global:{headers:{authorization:'Bearer '+token}}})
  expect((await client.rpc('current_org_id')).data).toBe(a)
  for(const table of ['conversations','messages']){const result=await client.from(table).select('*');expect(result.error,table).toBeNull();expect(result.data!.every(row=>row.org_id===a)).toBe(true);expect(JSON.stringify(result.data)).not.toContain('PRIVATE TENANT B')}
  expect((await client.from('users').update({role:'owner',active:true,org_id:b}).eq('id',actor)).error?.code).toBe('42501')
})
it('RLS email mapping is confirmed, unique, active and never overrides a disabled ID',async()=>{
  const legacy=await identity('security-legacy');expect(await rlsOrg(legacy.id)).toBeNull()
  await insert('users',{org_id:a,email:legacy.email,name:'Legacy',role:'member',password_hash:'local-fixture'})
  expect(await rlsOrg(legacy.id)).toBe(a)
  await insert('users',{org_id:b,email:legacy.email,name:'Duplicate',role:'member',password_hash:'local-fixture'});expect(await rlsOrg(legacy.id)).toBeNull()
  // Remove only the duplicate fixture; this test never changes the protected B baseline.
  await admin.from('users').delete().eq('org_id',b).eq('email',legacy.email)
  await insert('users',{id:legacy.id,org_id:a,email:legacy.email+'-disabled',name:'Disabled',role:'member',active:false,password_hash:'local-fixture'});expect(await rlsOrg(legacy.id)).toBeNull()
  const pending=await identity('security-unconfirmed',undefined,'owner',false);await insert('users',{org_id:a,email:pending.email,name:'Unconfirmed',role:'member',password_hash:'local-fixture'});expect(await rlsOrg(pending.id)).toBeNull()
})
it('all direct REST writes and privileged RPCs deny both anonymous and authenticated clients',async()=>{
  for(const credential of [token,stack.anonKey]){const client=createClient(stack.url,stack.anonKey,{auth:{persistSession:false},global:{headers:{authorization:'Bearer '+credential}}});for(const table of tenantTables){expect((await client.from(table).update({org_id:b}).eq('org_id',a)).error?.code,table).toBe('42501');if(!['messages','conversations'].includes(table))expect((await client.from(table).select('*')).error?.code,table).toBe('42501')}expect((await client.rpc('onboard_organization',{p_user:actor,p_name:'Attack',p_member_name:'Attack'})).error?.code).toBe('42501')}
})
it('new malformed tenant links and ownership moves fail before changing rows',async()=>{
  expect((await admin.from('conversations').insert({org_id:a,contact_id:bContact})).error?.code).toBe('PT404')
  expect((await admin.from('conversations').update({device_id:bDevice}).eq('id',aConversation)).error?.code).toBe('PT404')
  expect((await admin.from('conversations').update({org_id:b}).eq('id',aConversation)).error?.code).toBe('PT403')
})
it('onboarding refuses unauthenticated and unconfirmed identities with no mapping writes',async()=>{
  expect((await http('backend','/auth/onboard','POST',{companyName:'Attack',name:'Attack'},'invalid')).status).toBe(401)
  const pending=await identity('onboarding-pending',undefined,'owner',false)
  expect((await admin.rpc('onboard_organization',{p_user:pending.id,p_name:'Pending',p_member_name:'Pending'})).error?.code).toBe('PT403')
  expect((await admin.from('users').select('id').eq('id',pending.id)).data).toEqual([])
})
it('explicit onboarding ignores client tenant/role metadata and serializes concurrent requests',async()=>{
  const pending=await identity('onboarding-race'),payload={companyName:'New race workspace',name:'New owner',org_id:b,role:'admin'}
  const result=await Promise.all([http('backend','/auth/onboard','POST',payload,pending.token!),http('backend','/auth/onboard','POST',payload,pending.token!)])
  expect(result.map(r=>r.status).sort()).toEqual([201,409])
  const member=(await admin.from('users').select('*').eq('id',pending.id).single()).data!;expect(member.org_id).not.toBe(b);expect(member.role).toBe('owner')
  expect((await http('backend','/auth/me','GET',undefined,pending.token!)).body.data.orgId).toBe(member.org_id)
  expect((await http('backend','/auth/onboard','POST',payload,pending.token!)).status).toBe(409)
})
it.each(['backend','frontend'] as const)('%s viewer mutations are forbidden across existing resources',async surface=>{
  const paths=surface==='backend'?['/settings','/agents','/devices','/properties','/contacts','/conversations','/messages','/flows','/knowledge/anything/documents']:['/settings','/settings/handoff','/team','/agents','/devices','/properties','/contacts','/conversations','/flows','/knowledge-bases']
  const before=(await admin.from('organizations').select('*').eq('id',a)).data
  for(const path of paths)expect((await http(surface,path,path.startsWith('/settings')?'PATCH':'POST',{},viewer)).status,path).toBe(403)
  expect((await admin.from('organizations').select('*').eq('id',a)).data).toEqual(before)
})
it('real UI registers, confirms email and creates a new isolated owner workspace',async()=>{
  context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(10000);page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message))
  await page.goto(frontendUrl+'/login');await page.getByRole('button',{name:'Create an account',exact:true}).click()
  await page.getByLabel('Company name',{exact:true}).fill('Harbour Test Realty');await page.getByLabel('Your name',{exact:true}).fill('Workspace owner');const email='new-customer@phase11.example.invalid';await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);const registration=page.waitForResponse(r=>r.url().endsWith('/api/auth/register')&&r.request().method()==='POST');await page.getByRole('button',{name:'Create account',exact:true}).click();const response=await registration;expect(response.status(),JSON.stringify(await response.json())).toBe(202)
  await browserExpect(page.getByRole('status')).toContainText('confirm your account')
  expect((await context.cookies()).some(c=>c.name==='sb-access-token')).toBe(false)
  const mailbox=await fetch(stack.mailUrl+'/api/v1/messages').then(r=>r.json());expect(mailbox.messages.length).toBeGreaterThan(0)
  const message=await fetch(stack.mailUrl+'/api/v1/message/'+mailbox.messages[0].ID).then(r=>r.json())
  const html=message.HTML as string,link=html.match(/href="([^"]+\/auth\/v1\/verify[^\"]+)"/)?.[1]?.replaceAll('&amp;','&');expect(link).toBeTruthy();expect(new URL(link!).hostname).toBe('127.0.0.1')
  const confirmed=await fetch(link!,{redirect:'manual'});expect(confirmed.status).toBe(303);expect(confirmed.headers.get('location')).toContain(frontendUrl+'/login')
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await browserExpect(page).toHaveURL(frontendUrl+'/onboarding')
  const auth=await page.request.get(frontendUrl+'/api/auth/me').then(r=>r.json());workspace=auth.data.orgId;expect(workspace).not.toBe(b);expect(auth.data.role).toBe('owner')
  const cookie=(await context.cookies()).find(c=>c.name==='sb-access-token')!;expect(cookie.httpOnly).toBe(true);expect(cookie.sameSite).toBe('Lax');newToken=cookie.value
  await browserExpect(page.getByRole('heading',{name:'Make this workspace yours'})).toBeVisible();workflow.push('register','email confirmation','create organization','authorized cookies')
},120000)
it('a new tenant completes company, AI instructions, knowledge, inventory and team through the UI',async()=>{
  expect(workspace,'Registration must succeed before setup').toBeTruthy();await page.goto(frontendUrl+'/settings');await page.getByLabel('Company name',{exact:true}).fill('Harbour Test Realty');await page.getByLabel('Brand name',{exact:true}).fill('Harbour');await page.getByRole('button',{name:'Save profile',exact:true}).click();await browserExpect(page.getByRole('status').first()).toContainText(/saved/i);workflow.push('company profile')
  await page.goto(frontendUrl+'/ai-studio');await page.getByLabel('New assistant name',{exact:true}).fill('Harbour concierge');await page.getByRole('button',{name:'Create draft',exact:true}).click();await browserExpect(page).toHaveURL(/\/ai-studio\/[a-f0-9-]+$/);agent=page.url().split('/').at(-1)!
  await page.getByLabel('Instructions',{exact:true}).fill('Use only verified company and property facts. Honour requests for human support.');await page.getByLabel('property.lookup',{exact:true}).check();await page.getByLabel('property.search',{exact:true}).check();await page.getByLabel('handoff.create',{exact:true}).check();await page.getByRole('button',{name:'Save draft',exact:true}).click();await browserExpect(page.getByText('Draft saved',{exact:true})).toBeVisible();workflow.push('create AI agent','save instructions')
  await page.goto(frontendUrl+'/knowledge-base');await page.getByRole('button',{name:'New knowledge base',exact:true}).click();await page.getByRole('dialog').getByLabel('Name',{exact:true}).fill('Company guide');await page.getByRole('button',{name:'Create knowledge base',exact:true}).click();await page.locator('input[type=file]').setInputFiles({name:'guide.txt',mimeType:'text/plain',buffer:Buffer.from('Harbour verified company guide. Office hours are Monday to Friday 9 to 5.')});await page.getByRole('button',{name:'Upload document',exact:true}).click();await browserExpect(page.getByRole('article').getByText('guide.txt',{exact:true})).toBeVisible();await browserExpect(page.getByText(/Available version 1/)).toBeVisible();workflow.push('upload and index knowledge')
  await page.goto(frontendUrl+'/properties');await page.getByRole('button',{name:/Add Property/i}).first().click();await page.getByLabel('Reference Number',{exact:true}).fill('HARBOUR-101');await page.getByLabel('Price (AED)',{exact:true}).fill('1900000');await page.getByLabel('Size (sqft)',{exact:true}).fill('1200');await page.getByLabel('District',{exact:true}).fill('Dubai Marina');await page.getByLabel('Building',{exact:true}).fill('Harbour Tower');await page.getByLabel('Agent Name',{exact:true}).fill('Harbour team');await page.getByLabel('Agent WhatsApp',{exact:true}).fill('+971500000111');await page.getByRole('button',{name:'Create Property',exact:true}).click();await browserExpect(page.getByRole('dialog')).toHaveCount(0);workflow.push('manage properties')
  await page.goto(frontendUrl+'/team');await page.getByRole('button',{name:'Add team member',exact:true}).first().click();await page.getByLabel('Full Name',{exact:true}).fill('Harbour adviser');await page.getByLabel('WhatsApp',{exact:true}).fill('+971500000112');await page.getByLabel('Email',{exact:true}).fill('adviser@phase11.example.invalid');await page.getByRole('dialog').getByRole('button',{name:'Add Team Member',exact:true}).click();await browserExpect(page.getByRole('dialog')).toHaveCount(0);workflow.push('add team')
},120000)
it('onboarding connects a QR, previews and publishes the agent, then operates the inbound runtime locally',async()=>{
  expect(agent,'Agent setup must succeed before channel setup').toBeTruthy();await page.goto(frontendUrl+'/settings/handoff');await page.getByText('Automation and SLA preferences',{exact:true}).click();const saved=page.waitForResponse(r=>r.url().endsWith('/api/settings/handoff')&&r.request().method()==='PATCH');await page.getByRole('button',{name:'Save Handoff Settings',exact:true}).click();expect((await saved).status()).toBe(200);workflow.push('save handoff settings')
  await page.goto(frontendUrl+'/devices');await page.getByRole('button',{name:'Connect Device',exact:true}).first().click();await page.getByLabel('Device Name',{exact:true}).fill('Harbour local fixture');await page.getByRole('button',{name:'Create and Connect',exact:true}).click();await browserExpect(page.getByAltText('WhatsApp device QR code')).toBeVisible();await page.screenshot({path:resolve(output,'onboarding-qr.png'),fullPage:true})
  const devices=(await admin.from('devices').select('id').eq('org_id',workspace)).data!;device=devices[0].id;expect((await http('backend','/devices/'+device+'/disconnect','POST',{},newToken)).status).toBe(200);effects.connected.add(device);await admin.from('devices').update({status:'connected',qr_code:null}).eq('id',device).eq('org_id',workspace);workflow.push('QR rendered','simulated phone scan')
  await page.goto(frontendUrl+'/ai-studio/'+agent);await page.getByLabel(/Company guide/).check();await page.getByRole('button',{name:'Save draft',exact:true}).click();await browserExpect(page.getByText('Draft saved',{exact:true})).toBeVisible();workflow.push('link knowledge source');await page.goto(frontendUrl+'/ai-studio/'+agent+'/test');await page.getByLabel('User Message',{exact:true}).fill('مرحبا');await page.getByRole('button',{name:'Run draft test',exact:true}).click();await browserExpect(page.getByRole('status')).toContainText('Harbour');workflow.push('AI playground')
  await page.goto(frontendUrl+'/ai-studio/'+agent);await page.getByRole('button',{name:'Validate',exact:true}).click();await page.getByRole('button',{name:'Run checks',exact:true}).click();await browserExpect(page.getByRole('button',{name:'Publish version',exact:true})).toBeEnabled();const published=page.waitForResponse(r=>r.url().endsWith('/agents/'+agent+'/publish')&&r.request().method()==='POST');await page.getByRole('button',{name:'Publish version',exact:true}).click();expect((await published).status()).toBe(200);await page.getByLabel('Device',{exact:true}).selectOption(device);const assigned=page.waitForResponse(r=>r.url().endsWith('/agents/'+agent+'/channels')&&r.request().method()==='POST');await page.getByRole('button',{name:'Assign to this assistant',exact:true}).click();expect((await assigned).status()).toBe(200);workflow.push('mandatory tests','publish','channel link')
  const router=new MessageRouter(),incoming={key:{id:randomUUID(),remoteJid:'971500000119@s.whatsapp.net',fromMe:false},message:{conversation:'Send property HARBOUR-101'}}
  await router.routeMessage(device,workspace,incoming);expect(effects.send.mock.calls.at(-1)?.[0]).toMatchObject({orgId:workspace,deviceId:device});expect(JSON.stringify(effects.send.mock.calls.at(-1)?.[0])).toContain('HARBOUR-101');const sent=effects.send.mock.calls.length;await router.routeMessage(device,workspace,incoming);expect(effects.send).toHaveBeenCalledTimes(sent);workflow.push('published runtime exact property','duplicate suppression')
  const progress=await http('backend','/auth/onboarding','GET',undefined,newToken);expect(progress.status).toBe(200);expect(Object.values(progress.body.data.complete).every(Boolean),JSON.stringify(progress.body)).toBe(true)
},120000)
it.each([{name:'desktop',width:1440,height:1000,rtl:false},{name:'mobile',width:390,height:844,rtl:false},{name:'rtl',width:1100,height:900,rtl:true}])('polished onboarding is accessible and responsive at $name',async viewport=>{
  await page.setViewportSize({width:viewport.width,height:viewport.height});await page.goto(frontendUrl+'/onboarding');await browserExpect(page.getByRole('heading',{name:'Make this workspace yours'})).toBeVisible();if(viewport.rtl)await page.locator('#workspace-content').evaluate(el=>el.setAttribute('dir','rtl'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const result=await new AxeBuilder({page}).analyze();const critical=result.violations.filter(v=>v.impact==='critical');expect(critical).toEqual([]);accessibility.push({page:'/onboarding',viewport:viewport.name,critical:critical.length,violations:result.violations.map(v=>({id:v.id,impact:v.impact}))});await page.screenshot({path:resolve(output,'onboarding-'+viewport.name+'.png'),fullPage:true})
})
it('all existing workspaces render with no critical accessibility or page errors',async()=>{
  await page.setViewportSize({width:1440,height:1000})
  const failures:unknown[]=[]
  for(const path of ['/dashboard','/inbox','/contacts','/pipeline','/properties','/team','/knowledge-base','/devices','/analytics','/settings','/activity-log']){await page.goto(frontendUrl+path);await browserExpect(page.locator('#workspace-content')).toBeVisible();await page.waitForTimeout(250);const result=await new AxeBuilder({page}).analyze();const critical=result.violations.filter(v=>v.impact==='critical');if(critical.length)failures.push({path,critical:critical.map(v=>({id:v.id,nodes:v.nodes.map(n=>({html:n.html,target:n.target}))}))});accessibility.push({page:path,critical:critical.length,violations:result.violations.map(v=>({id:v.id,impact:v.impact}))});await page.screenshot({path:resolve(output,path.slice(1)+'.png'),fullPage:true})}
  expect(failures).toEqual([]);expect(browserErrors).toEqual([])
},120000)
it('bounded concurrent authenticated reads preserve tenant isolation and reject forged JWTs',async()=>{
  const started=Date.now(),responses=await Promise.all(Array.from({length:40},()=>http('backend','/contacts?org_id='+b,'GET')));expect(responses.every(r=>r.status===200&&!JSON.stringify(r.body).includes('PRIVATE TENANT B'))).toBe(true);checks.push({concurrentReads:40,elapsedMs:Date.now()-started})
  const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(parts[1],'base64url').toString()),sub:randomUUID(),org_id:b})).toString('base64url');expect((await http('backend','/auth/me','GET',undefined,parts.join('.'))).status).toBe(401)
  expect((await http('frontend','/properties','POST',{},newToken)).status).toBe(400)
  const csrf=await fetch(frontendUrl+'/api/settings',{method:'PATCH',headers:{cookie:'sb-access-token='+newToken,origin:'https://evil.invalid','content-type':'application/json'},body:'{}'});expect(csrf.status).toBe(403)
})




