import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Server } from 'node:http'
import { createRequire } from 'node:module'
import { createApiApp } from '../../backend/src/api/app'

const transport = vi.hoisted(() => ({ send: vi.fn(async () => ({ deviceId: 'stub', messageId: 'stub' })), generate: vi.fn(async () => ({ reply: 'Fixture response', lane: 'general', lang: 'en', handoff: false })) }))
vi.mock('../../backend/src/whatsapp/WhatsAppGateway', () => ({ whatsAppGateway: {
  sendText: transport.send, getRuntimeSnapshot: () => null, normalizeDeviceStatus: (status: string) => status,
  getTransportHealth: () => null, getConnectedDeviceIds: () => [], getRuntimeSnapshotSummary: () => ({ connectedDeviceIds: [], trackedDevices: 0, healthyDevices: 0, connectingDevices: 0, unhealthyDevices: 0, replacedConflicts: 0, sendFailures: 0, alerts: [] }),
} }))
vi.mock('../../backend/src/modules/ai/aiService', () => ({ generateReply: transport.generate, sanitize: (text: string) => text }))

const config = JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!, 'utf8'))
const admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const password = 'Phase1-fixture-password-123!'
const a = Object.fromEntries(['org','contact','conversation','device','agent','kb','chunk','team','flow','step','booking','nudge'].map(key => [key, randomUUID()]))
const b = Object.fromEntries(Object.keys(a).map(key => [key, randomUUID()]))
const malformed = { conversation: randomUUID(), agent: randomUUID(), message: randomUUID(), step: randomUUID(), reverseConversation: randomUUID(), protectedMessage:randomUUID(), alertContact:randomUUID() }
const tables = ['organizations','users','agents','devices','properties','contacts','conversations','messages','knowledge_bases','knowledge_chunks','team_members','flows','flow_steps','bookings','nudge_jobs','handoff_events','inventory_gaps','contact_flows','lead_assignments','lead_scores','baileys_sessions','notifications','notification_preferences','contact_memory','alerts','sentiment_history']
let server: Server, next: ChildProcess, backendUrl: string, frontendUrl: string
let token: string, bToken: string, unknownToken: string, disabledToken: string, legacyToken: string
let baselineB: unknown
let requests = 0
let snapshotChecks = 0
const frontendLogs: string[] = []

async function insert(table: string, rows: any) {
  const result = await admin.from(table).insert(rows)
  if (result.error) throw new Error(table + ': ' + result.error.message)
}
// Seed historical corruption under a privileged transaction. Production writes
// now reject these links; the API must still safely handle pre-upgrade rows.
async function legacyInsert(table:string,row:Record<string,unknown>){
  const pg=createRequire(import.meta.url)('pg'),db=new pg.Client({connectionString:config.dbUrl})
  await db.connect()
  try{
    await db.query('BEGIN')
    const guard=await db.query("SELECT 1 FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname='phase11_guard_tenant_links'",['public.'+table])
    if(guard.rowCount)await db.query(`ALTER TABLE public.${table} DISABLE TRIGGER phase11_guard_tenant_links`)
    const entries=Object.entries(row)
    if(!/^[a-z_]+$/.test(table)||entries.some(([key])=>!/^[a-z_]+$/.test(key)))throw Error('Invalid fixture identifier')
    await db.query(`INSERT INTO public.${table} (${entries.map(([key])=>key).join(',')}) VALUES (${entries.map((_,i)=>'$'+(i+1)).join(',')})`,entries.map(([,value])=>value))
    await db.query('SET CONSTRAINTS ALL IMMEDIATE')
    if(guard.rowCount)await db.query(`ALTER TABLE public.${table} ENABLE TRIGGER phase11_guard_tenant_links`)
    await db.query('COMMIT')
  }catch(error){await db.query('ROLLBACK');throw error}finally{await db.end()}
}
async function identity(email: string) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { org_id: b.org, role: 'owner' }, user_metadata: { org_id: b.org } })
  if (created.error) throw created.error
  const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error) throw signed.error
  return { id: created.data.user.id, token: signed.data.session!.access_token, email }
}
async function call(surface: 'backend' | 'frontend', path: string, method = 'GET', body?: any, credential = token) {
  requests++
  const response = await fetch((surface === 'backend' ? backendUrl + '/api/v1' : frontendUrl + '/api') + path, { method, headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { response, body: await response.json() }
}
async function snapshotB() {
  const entries = await Promise.all(tables.map(async table => {
    const query = admin.from(table).select('*').eq(table === 'contact_memory' ? 'contact_id' : table === 'organizations' ? 'id' : 'org_id', table === 'contact_memory' ? b.contact : b.org).order('id')
    const rows = await query
    if (rows.error) throw new Error('Snapshot ' + table + ': ' + rows.error.message)
    return [table, rows.data]
  }))
  return Object.fromEntries(entries)
}
beforeAll(async () => {
  const [userA, userB, unknown, disabled, legacy] = await Promise.all(['tenant-a','tenant-b','unknown','disabled','legacy'].map(name => identity(name + '@phase1.example.invalid')))
  token = userA.token; bToken = userB.token; unknownToken = unknown.token; disabledToken = disabled.token; legacyToken = legacy.token
  await insert('organizations', [{ id: a.org, name: 'Tenant A fixture', slug: 'phase1-a' }, { id: b.org, name: 'Tenant B sentinel', slug: 'phase1-b' }])
  await insert('users', [{ id: userA.id, org_id: a.org, email: userA.email, name: 'Stored A', role: 'admin', active: true, password_hash: 'fixture' }, { id: userB.id, org_id: b.org, email: userB.email, name: 'Stored B', role: 'admin', active: true, password_hash: 'fixture' }, { id: disabled.id, org_id: a.org, email: disabled.email, name: 'Disabled', role: 'admin', active: false, password_hash: 'fixture' }, { id: randomUUID(), org_id: a.org, email: legacy.email, name: 'Legacy', role: 'viewer', active: true, password_hash: 'fixture' }])
  for (const [tenant, label, phone] of [[a, 'Tenant A fixture', '+100000001'], [b, 'Tenant B sentinel', '+200000002']] as const) {
    await insert('team_members', { id: tenant.team, org_id: tenant.org, name: label, role: 'Agent', whatsapp: phone, email: label.startsWith('Tenant A') ? userA.email : userB.email })
    await insert('devices', { id: tenant.device, org_id: tenant.org, name: label, status: 'disconnected' })
    await insert('baileys_sessions', { org_id:tenant.org,device_id:tenant.device,key_type:'fixture',key_id:'fixture',data:label+' private session' })
    await insert('knowledge_bases', { id: tenant.kb, org_id: tenant.org, name: label, source_type: 'text' })
    await insert('knowledge_chunks', { id: tenant.chunk, org_id: tenant.org, knowledge_base_id: tenant.kb, content: label })
    await insert('flows', { id: tenant.flow, org_id: tenant.org, name: label, trigger_type: 'keyword' })
    await insert('flow_steps', { id: tenant.step, org_id: tenant.org, flow_id: tenant.flow, step_order: 0, step_type: 'send_message', config: { content: label } })
    await insert('agents', { id: tenant.agent, org_id: tenant.org, name: label, system_prompt: label, knowledge_base_id: tenant.kb, default_flow_id: tenant.flow })
    await insert('contacts', { id: tenant.contact, org_id: tenant.org, phone, name: label, assigned_to: tenant.team })
    await insert('conversations', { id: tenant.conversation, org_id: tenant.org, contact_id: tenant.contact, device_id: tenant.device })
    await insert('messages', { org_id: tenant.org, conversation_id: tenant.conversation, direction: 'inbound', sender_type: 'contact', content: label })
    await insert('properties', { org_id: tenant.org, ref: label.startsWith('Tenant A') ? 'PHASE1-A' : 'PHASE1-B', ref_number: label.startsWith('Tenant A') ? 'PHASE1-A' : 'PHASE1-B', district: 'Dubai Marina', price_aed: 1900000, type: 'apartment', category: 'sale', agent_id: tenant.team })
    await insert('bookings', { id: tenant.booking, org_id: tenant.org, contact_id: tenant.contact, conversation_id: tenant.conversation, scheduled_date: '2026-12-01T10:00:00Z', scheduled_time: '10:00', notes: label })
    await insert('nudge_jobs', { id: tenant.nudge, org_id: tenant.org, contact_id: tenant.contact, conversation_id: tenant.conversation, nudge_type: '24h', scheduled_at: '2026-12-01T10:00:00Z' })
  }
  // SQL allows these historical inconsistencies; APIs must contain them.
  await legacyInsert('conversations', { id: malformed.conversation, org_id: a.org, contact_id: b.contact, device_id: b.device })
  await legacyInsert('conversations', { id: malformed.reverseConversation, org_id: b.org, contact_id: a.contact })
  await legacyInsert('agents', { id: malformed.agent, org_id: a.org, name: 'Malformed A agent', system_prompt: 'fixture', knowledge_base_id: b.kb, default_flow_id: b.flow })
  await legacyInsert('messages', { id: malformed.message, org_id: b.org, conversation_id: a.conversation, content: 'Tenant B sentinel leaked child', direction: 'inbound' })
  await legacyInsert('flow_steps', { id: malformed.step, org_id: b.org, flow_id: a.flow, step_order: 1, step_type: 'send_message', config: { content: 'Tenant B sentinel leaked step' } })
  await insert('contact_memory', { contact_id:b.contact,key:'tenantPrivate',value:'Tenant B sentinel memory' })
  await insert('contacts',{ id:malformed.alertContact,org_id:a.org,phone:'+100000077' })
  await legacyInsert('alerts',{ org_id:b.org,contact_id:malformed.alertContact,type:'system',priority:'low',title:'Tenant B sentinel',message:'Tenant B sentinel' })
  await insert('messages',{ id:malformed.protectedMessage,org_id:a.org,conversation_id:a.conversation,direction:'outbound',sender_type:'ai',content:'A fixture' })
  await legacyInsert('sentiment_history',{ org_id:b.org,contact_id:b.contact,message_id:malformed.protectedMessage,sentiment_score:0,sentiment:'neutral',confidence:1,escalation_risk:'low' })
  await legacyInsert('nudge_jobs',{ org_id:b.org,contact_id:b.contact,device_id:a.device,nudge_type:'24h',scheduled_at:'2026-12-01T10:00:00Z' })
  server = await new Promise<Server>(resolve => { const listener = createApiApp(0).listen(0, '127.0.0.1', () => resolve(listener)) })
  backendUrl = 'http://127.0.0.1:' + (server.address() as any).port
  process.env.BACKEND_URL = backendUrl
  // Next binds port 0 and publishes the allocated URL in its startup output.
  next = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-p', '0', '-H', '127.0.0.1'], { cwd: resolve('frontend'), env: { ...process.env, NODE_ENV: 'production', BACKEND_URL: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next startup timed out')), 60000)
    const output = (chunk: Buffer) => { const text = chunk.toString(); frontendLogs.push(text); const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) frontendUrl = match[0]; if (/Ready in/.test(text)) { clearTimeout(timeout); resolve() } }
    next.stdout!.on('data', output); next.stderr!.on('data', output); next.on('exit', code => { clearTimeout(timeout); reject(new Error('Next startup exit ' + code)) })
  })
})
beforeEach(async () => { baselineB = await snapshotB(); transport.send.mockClear(); transport.generate.mockClear() })
afterEach(async () => { expect(await snapshotB(), 'Tenant B rows must remain byte-equivalent').toEqual(baselineB); snapshotChecks++ })
afterAll(async () => {
  writeFileSync(resolve(config.directory, 'frontend.log'), frontendLogs.join(''))
  writeFileSync(resolve(config.directory, 'http-evidence.json'), JSON.stringify({ requests, tenantBSnapshotChecks: snapshotChecks, snapshotTables: tables, productionMigrationsAdded: 1, appliedToLiveProject:false }))
  next?.kill()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
})

describe.each(['backend', 'frontend'] as const)('%s real HTTP authorization', surface => {
  it.each([['unknown', () => unknownToken], ['disabled', () => disabledToken]])('denies %s identity', async (_name, credential) => {
    expect((await call(surface, '/agents', 'GET', undefined, credential())).response.status).toBe(403)
  })
  it('rejects manipulated token', async () => { expect((await call(surface, '/agents', 'GET', undefined, token.slice(0, -6) + 'forged')).response.status).toBe(401) })
  it('resolves legacy confirmed email and ignores identity metadata', async () => {
    const result = await call(surface, '/auth/me', 'GET', undefined, legacyToken)
    expect(result.response.status).toBe(200)
    expect(result.body.data).toMatchObject({ orgId: a.org, role: 'viewer', name: 'Legacy' })
  })
  it.each(['agents','devices','properties','contacts','bookings','flows'])('list %s ignores forged organization query', async resource => {
    const result = await call(surface, '/' + resource + '?orgId=' + b.org + '&org_id=' + b.org)
    expect(result.response.status, JSON.stringify(result.body)).toBe(200)
    expect(JSON.stringify(result.body)).not.toContain('Tenant B sentinel')
  })
  it('settings ignores forged organization query', async () => {
    const result = await call(surface, '/settings?orgId=' + b.org)
    expect(result.response.status).toBe(200)
    expect(JSON.stringify(result.body)).not.toContain('Tenant B sentinel')
  })
  it('messages excludes malformed foreign child', async () => {
    const result = surface === 'backend' ? await call(surface, '/messages?conversationId=' + a.conversation) : await call(surface, '/conversations/' + a.conversation + '/messages')
    expect(result.response.status).toBe(200)
    expect(JSON.stringify(result.body)).not.toContain('Tenant B sentinel')
  })
  it.each(['PATCH','DELETE'])('mixed-tenant bulk %s changes no rows', async method => {
    const before = await admin.from('conversations').select('*').eq('id', a.conversation).single()
    expect((await call(surface, surface === 'backend' ? '/conversations/bulk' : '/v1/conversations/bulk', method, { ids: [a.conversation, b.conversation], status: 'archived' })).response.status).toBe(404)
    expect((await admin.from('conversations').select('*').eq('id', a.conversation).single()).data).toEqual(before.data)
  })
  it('bulk deletion blocks malformed foreign children before cleanup', async () => {
    expect((await call(surface, surface === 'backend' ? '/conversations/bulk' : '/v1/conversations/bulk', 'DELETE', { ids: [a.conversation] })).response.status).toBe(409)
  })
})
it.each([['agents', b.agent], ['devices', b.device], ['contacts', b.contact], ['properties', 'PHASE1-B'], ['knowledge', b.kb + '/chunks'], ['flows', b.flow]] as const)('backend foreign %s ID is 404', async (resource, id) => {
  expect((await call('backend', '/' + resource + '/' + id)).response.status).toBe(404)
})
it.each([['agents', b.agent], ['devices', b.device + '/qr'], ['contacts', b.contact], ['conversations', b.conversation], ['knowledge-bases', b.kb], ['flows', b.flow], ['bookings', b.booking]] as const)('frontend foreign %s ID is 404', async (resource, id) => {
  expect((await call('frontend', '/' + resource + '/' + id)).response.status).toBe(404)
})
it.each([['agents', b.agent, { name: 'attack' }], ['contacts', b.contact, { name: 'attack' }], ['conversations', b.conversation, { status: 'archived' }], ['knowledge-bases', b.kb, { name: 'attack' }], ['flows', b.flow, { name: 'attack' }], ['bookings', b.booking, { notes: 'attack' }]] as const)('frontend foreign %s update is 404', async (resource, id, payload) => {
  expect((await call('frontend', '/' + resource + '/' + id, 'PATCH', payload)).response.status).toBe(404)
})
it.each([['agents', b.agent], ['contacts', b.contact], ['knowledge-bases', b.kb], ['flows', b.flow]] as const)('frontend foreign %s deletion is 404', async (resource, id) => {
  expect((await call('frontend', '/' + resource + '/' + id, 'DELETE')).response.status).toBe(404)
})
it('frontend nested agent and flow children cannot leak B data', async () => {
  for (const path of ['/agents/' + malformed.agent, '/flows/' + a.flow, '/knowledge-bases', '/conversations']) {
    const result = await call('frontend', path)
    expect(result.response.status, JSON.stringify(result.body)).toBe(200)
    expect(JSON.stringify(result.body)).not.toContain('Tenant B sentinel')
  }
})
it.each(['POST','PATCH'])('agent %s rejects foreign KB and flow links', async method => {
  for (const field of ['knowledgeBaseId','defaultFlowId']) {
    const payload = { name: 'fixture agent', systemPrompt: 'fixture', [field]: field === 'knowledgeBaseId' ? b.kb : b.flow }
    expect((await call('frontend', '/agents' + (method === 'PATCH' ? '/' + a.agent : ''), method, payload)).response.status).toBe(404)
  }
})
it('conversation creation rejects foreign contact, device and team assignment', async () => {
  for (const payload of [{ contactId: b.contact }, { contactId: a.contact, deviceId: b.device }, { contactId: a.contact, assignedTo: b.team }]) {
    expect((await call('frontend', '/conversations', 'POST', payload)).response.status).toBe(404)
  }
})
it.each(['backend','frontend'] as const)('%s rejects foreign assignments and booking references', async surface => {
  const assignment = surface === 'backend' ? { assigned_to: b.team } : { assignedTo: b.team }
  expect((await call(surface, '/contacts/' + a.contact, 'PATCH', assignment)).response.status).toBe(404)
  const booking = surface === 'backend' ? { contact_id: b.contact, scheduled_date: '2026-12-01T10:00:00Z', scheduled_time: '10:00' } : { contactId: b.contact, scheduledDate: '2026-12-01T10:00:00Z', scheduledTime: '10:00' }
  expect((await call(surface, '/bookings', 'POST', booking)).response.status).toBe(404)
  for (const foreign of ['conversation','property']) {
    const payload = surface === 'backend' ? { ...booking, contact_id: a.contact, [foreign === 'conversation' ? 'conversation_id' : 'property_ref']: foreign === 'conversation' ? b.conversation : 'PHASE1-B' } : { ...booking, contactId: a.contact, [foreign === 'conversation' ? 'conversationId' : 'propertyRef']: foreign === 'conversation' ? b.conversation : 'PHASE1-B' }
    expect((await call(surface, '/bookings', 'POST', payload)).response.status).toBe(404)
  }
})
it('malformed send context is denied before outbound transport or provider invocation', async () => {
  expect((await call('backend', '/messages', 'POST', { conversationId: malformed.conversation, content: 'attack' })).response.status).toBe(404)
  expect((await call('backend', '/chat', 'POST', { conversationId: malformed.conversation, message: 'attack' })).response.status).toBe(404)
  expect((await call('frontend', '/chat', 'POST', { conversationId: b.conversation, message: 'attack' })).response.status).toBe(404)
  expect(transport.send).not.toHaveBeenCalled(); expect(transport.generate).not.toHaveBeenCalled()
})
it('contact deletion is blocked before a malformed B conversation can cascade', async () => {
  expect((await call('frontend', '/contacts/' + a.contact, 'DELETE')).response.status).toBe(409)
})
it('team list and knowledge list are tenant-scoped', async () => {
  for (const [surface,path] of [['frontend','/team'], ['frontend','/knowledge-bases'], ['backend','/knowledge']] as const) {
    const result = await call(surface, path + '?orgId=' + b.org)
    expect(result.response.status).toBe(200); expect(JSON.stringify(result.body)).not.toContain('Tenant B sentinel')
  }
})
it.each(['backend','frontend'] as const)('%s property insert ignores forged organization body', async surface => {
  const ref = 'PHASE1-NEW-' + surface
  const payload = surface === 'backend' ? { ref, district: 'Dubai Marina', price_aed: 1900000, org_id: b.org } : { refNumber: ref, transactionType: 'SALE', category: 'apartment', district: 'Dubai Marina', priceAed: 1900000, orgId: b.org, org_id: b.org }
  const result = await call(surface, '/properties', 'POST', payload)
  expect(result.response.status, JSON.stringify(result.body)).toBe(201)
  const row = await admin.from('properties').select('org_id').eq('id',result.body.data.id).single()
  expect(row.data?.org_id).toBe(a.org)
})
it('valid agent links and message persistence continue to work', async () => {
  expect((await call('frontend', '/agents', 'POST', { name: 'New A', systemPrompt: 'fixture', knowledgeBaseId: a.kb, defaultFlowId: a.flow })).response.status).toBe(201)
  const result = await call('frontend', '/conversations/' + a.conversation + '/messages', 'POST', { direction: 'inbound', senderType: 'contact', content: 'A persisted' })
  expect(result.response.status, JSON.stringify(result.body)).toBe(201)
  const row = await admin.from('messages').select('org_id').eq('content','A persisted').single()
  expect(row.data?.org_id).toBe(a.org)
})
it('unmapped login issues no cookies; valid login yields authorized cookie identity', async () => {
  for (const [email, status] of [['unknown@phase1.example.invalid',403], ['tenant-a@phase1.example.invalid',200]] as const) {
    const result = await fetch(frontendUrl + '/api/auth/login', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ email,password }) })
    expect(result.status).toBe(status)
    const cookies = result.headers.getSetCookie()
    if (status === 403) expect(cookies).toEqual([])
    else {
      expect(cookies.some(cookie => cookie.startsWith('sb-access-token=') && cookie.includes('HttpOnly'))).toBe(true)
      const me = await fetch(frontendUrl + '/api/auth/me', { headers: { cookie: cookies.map(value => value.split(';')[0]).join('; ') } })
      expect(me.status).toBe(200); expect((await me.json()).data.orgId).toBe(a.org)
    }
  }
})
it('public probes disclose no tenant identifiers; authenticated status is scoped', async () => {
  expect((await fetch(backendUrl + '/api/v1/setup/status')).status).toBe(401)
  expect((await fetch(backendUrl + '/api/v1/health')).status).toBe(401)
  const status = await call('backend','/setup/status')
  expect(status.response.status).toBe(200)
  expect(JSON.stringify(status.body)).not.toContain(b.device)
})
it('direct authenticated REST cannot read or modify Tenant B rows', async () => {
  const userClient = createClient(config.url, config.anonKey, { global: { headers: { Authorization: 'Bearer '+token } }, auth: { persistSession:false } })
  const read = await userClient.from('contacts').select('*').eq('id',b.contact)
  expect(read.error?.code).toBe('42501'); expect(read.data??[]).toEqual([])
  const write = await userClient.from('contacts').update({ name:'attack' }).eq('id',b.contact).select('*')
  expect(write.error?.code).toBe('42501'); expect(write.data??[]).toEqual([])
  expect((await call('backend','/agents','GET',undefined,bToken)).response.status).toBe(200)
  // Legacy views must obey base-table RLS, and normalized memory is server-only.
  const view = await userClient.from('ai_agents').select('id').eq('org_id', b.org)
  const anonymous = createClient(config.url, config.anonKey, { auth: { persistSession:false } })
  const publicView = await anonymous.from('ai_agents').select('id').eq('org_id', b.org)
  const memory = await anonymous.from('contact_memory').select('value').eq('contact_id',b.contact)
  const viewAudit: Record<string,unknown> = {}
  for (const viewName of ['ai_agents','whatsapp_devices','conversation_flows','wa_session_keys']) {
    const read = await anonymous.from(viewName).select('id').eq('org_id',b.org)
    viewAudit[viewName] = { rows:read.data?.length ?? 0,error:read.error?.code ?? null }
  }
  writeFileSync(resolve(config.directory, 'data-api-audit.json'), JSON.stringify({ activeMigration:'017_tenant_data_api_guard.sql', appliedToLiveProject:false, authenticatedViewReadCount:view.data?.length ?? 0, authenticatedViewError:view.error?.code ?? null, anonymousViewReadCount:publicView.data?.length ?? 0, anonymousViewError:publicView.error?.code ?? null, anonymousMemoryReadCount:memory.data?.length ?? 0, anonymousMemoryError:memory.error?.code ?? null, viewAudit }))
  const pg = createRequire(import.meta.url)('pg')
  const database = new pg.Client({ connectionString:config.dbUrl })
  await database.connect()
  try {
    const relations = await database.query("select c.relname, c.relkind, c.relrowsecurity, c.reloptions, has_table_privilege('anon',c.oid,'SELECT') as anon_select, has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v') order by c.relname")
    const functions = await database.query("select p.proname, pg_get_function_identity_arguments(p.oid) as arguments, has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute, has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef order by p.proname")
    writeFileSync(resolve(config.directory,'database-access-audit.json'),JSON.stringify({ relations:relations.rows,securityDefinerFunctions:functions.rows },null,2))
  } finally { await database.end() }
  expect(view.data ?? []).toEqual([]); expect(publicView.data ?? []).toEqual([])
  expect(memory.data ?? []).toEqual([]); expect(memory.error?.code).toBe('42501')
  for (const [name,audit] of Object.entries(viewAudit)) expect((audit as { rows:number }).rows,name).toBe(0)
  for (const client of [anonymous,userClient]) {
    const denied = await client.from('contact_memory').update({ value:'attack' }).eq('contact_id',b.contact).select('id')
    expect(denied.error?.code).toBe('42501')
    const deniedRead = await client.from('contact_memory').select('value').eq('contact_id',b.contact)
    expect(deniedRead.error?.code).toBe('42501')
    for (const [name,patch] of [['ai_agents',{ name:'attack' }],['whatsapp_devices',{ name:'attack' }],['conversation_flows',{ name:'attack' }],['wa_session_keys',{ value:'attack' }]] as const) {
      const read = await client.from(name).select('id').eq('org_id',b.org)
      expect(read.error?.code).toBe('42501'); expect(read.data??[]).toEqual([])
      const update = await client.from(name).update(patch).eq('org_id',b.org).select('id')
      // Phase 3 additionally denies direct writes through the legacy agent view.
      expect(update.error?.code).toBe('42501');expect(update.data??[]).toEqual([])
    }
  }
})
it('protected pages preserve unmapped membership status', async () => {
  const response = await fetch(frontendUrl + '/dashboard', { headers: { cookie: 'sb-access-token=' + unknownToken }, redirect: 'manual' })
  expect(response.status).toBe(403)
})
it('flow creation rejects a foreign next step before creating a parent', async () => {
  const before = await admin.from('flows').select('id').eq('org_id',a.org)
  const denied = await call('frontend','/flows','POST',{ name:'Bad flow', steps:[{ order:0,type:'send_message',nextStepId:b.step }] })
  expect(denied.response.status).toBe(404)
  expect((await admin.from('flows').select('id').eq('org_id',a.org)).data).toEqual(before.data)
  const valid = await call('frontend','/flows','POST',{ name:'Valid A flow', steps:[{ order:0,type:'send_message',config:{ content:'Hello' } }] })
  expect(valid.response.status,JSON.stringify(valid.body)).toBe(201)
  const steps = await admin.from('flow_steps').select('org_id').eq('flow_id',valid.body.data.id)
  expect(steps.data).toEqual([{ org_id:a.org }])
})
it('foreign device operations are denied before transport access', async () => {
  for (const surface of ['backend','frontend'] as const) {
    for (const operation of ['connect','disconnect','qr']) {
      expect((await call(surface,'/devices/'+b.device+'/'+operation, operation === 'qr' ? 'GET' : 'POST')).response.status).toBe(404)
    }
    expect((await call(surface,'/devices/'+b.device,'DELETE')).response.status).toBe(404)
  }
})
it('team insertion cannot override server organization', async () => {
  const result = await call('frontend','/team','POST',{ name:'New A team', role:'Agent', whatsapp:'+100000099',email:'new-a@phase1.example.invalid',org_id:b.org,orgId:b.org })
  expect(result.response.status,JSON.stringify(result.body)).toBe(201)
  expect((await admin.from('team_members').select('org_id').eq('id',result.body.data.id).single()).data?.org_id).toBe(a.org)
})
it('settings writes remain in A; team settings reject foreign assignment', async () => {
  const backend = await call('backend','/settings','PATCH',{ name:'Updated A',orgId:b.org,org_id:b.org })
  expect(backend.response.status).toBe(200)
  const frontend = await call('frontend','/settings','PATCH',{ organizationName:'Updated A',organizationSlug:'phase1-a',timezone:'Asia/Dubai',language:'en',whatsapp:{ maxRetries:3,propertySyncMinutes:15,nudge24h:true,nudge72h:false },orgId:b.org,org_id:b.org })
  expect(frontend.response.status,JSON.stringify(frontend.body)).toBe(200)
  const denial = await call('frontend','/settings/team','PATCH',{ defaultHandoffAgentId:b.team,autoAssignEnabled:true,roundRobinEnabled:false,assignmentPriority:'area-expert' })
  expect(denial.response.status).toBe(404)
  expect((await call('backend','/settings','PATCH',{ settings:{ team:{ defaultHandoffAgentId:b.team } } })).response.status).toBe(404)
})
it('nudge creation rejects foreign conversation links', async () => {
  expect((await call('frontend','/v1/nudges/send-now','POST',{ contactId:a.contact,conversationId:b.conversation })).response.status).toBe(404)
})
it('nullable links and message cascades cannot change foreign alerts, nudges or sentiment', async () => {
  expect((await call('frontend','/contacts/'+malformed.alertContact,'DELETE')).response.status).toBe(409)
  expect((await call('frontend','/v1/messages/'+malformed.protectedMessage,'DELETE')).response.status).toBe(409)
  expect((await call('backend','/devices/'+a.device,'DELETE')).response.status).toBe(409)
  expect((await call('frontend','/v1/messages/'+malformed.message,'DELETE')).response.status).toBe(404)
})
it('malformed active agent KB is rejected before optional provider retrieval', async () => {
  await admin.from('agents').update({ active:false }).eq('org_id',a.org).eq('id',a.agent)
  try {
    const response = await call('frontend','/chat','POST',{ message:'Tell me about your services',conversationId:a.conversation })
    expect(response.response.status,JSON.stringify(response.body)).toBe(404)
  } finally { await admin.from('agents').update({ active:true }).eq('org_id',a.org).eq('id',a.agent) }
})
