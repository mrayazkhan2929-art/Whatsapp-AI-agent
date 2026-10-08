import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Server } from 'node:http'
import { createApiApp } from '../../backend/src/api/app'
import { defaultAgentConfig, type AgentConfig } from '../../backend/src/modules/config/AgentVersionService'
import { MessageRouter } from '../../backend/src/whatsapp/MessageRouter'

const transport = vi.hoisted(() => ({ send: vi.fn(async (_input: { text: string }) => ({ deviceId: (_input as any).deviceId, messageId: (_input as any).messageId ?? 'local-stub' })), provider: vi.fn(async (input: { system: string }) => ({ content: [{ type: 'text', text: 'Verified configuration reply: ' + (input.system.match(/RELEASE_[A-Z0-9_]+/)?.[0] ?? 'NO_MARKER') }] })) }))
vi.mock('../../backend/src/whatsapp/WhatsAppGateway', () => ({ whatsAppGateway: { sendText: transport.send, getConnectedDeviceIds: () => [], getRuntimeSnapshotSummary: () => ({}), getRuntimeSnapshot: () => null, normalizeDeviceStatus: (status: string) => status, getTransportHealth: () => null } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: transport.provider } } }))
vi.mock('groq-sdk', () => ({ default: class { chat = { completions: { create: vi.fn(() => { throw new Error('Unexpected Groq call') }) } } } }))
// Exercise authentication and tenant checks at full speed without testing the time-window limiter here.
vi.mock('../../backend/src/api/middleware/rateLimit', () => ({ apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next() }))
const stack = JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!, 'utf8'))
const admin = createClient(stack.url, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const a = randomUUID(), b = randomUUID(), device = randomUUID(), bDevice = randomUUID(), unusedDevice = randomUUID(), aKb = randomUUID(), bKb = randomUUID(), bFlow = randomUUID()
const tables = ['organizations', 'users', 'agents', 'agent_versions', 'agent_drafts', 'agent_config_events', 'agent_version_tools', 'agent_version_knowledge_bases', 'agent_channel_links', 'devices', 'knowledge_bases', 'flows', 'contacts', 'conversations', 'messages']
const output = resolve(process.env.PHASE_AGENT_REPORT_DIR ?? 'docs/phase3/artifacts')
let server: Server, next: ChildProcess, browser: Browser, backendUrl: string, frontendUrl: string
let token: string, bToken: string, viewerToken: string, actor: string, bAgent: string, bVersion: string
let beforeB: unknown, requests = 0, bChecks = 0, externalRequests = 0
const logs: string[] = []
const browserErrors: string[] = []
async function insert(table: string, rows: unknown) { const result = await admin.from(table).insert(rows as any); if (result.error) throw result.error }
async function identity(label: string, orgId: string, role = 'admin') {
  const email = label + '@phase3.example.invalid', password = 'Phase3-local-fixture-123!'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { org_id: b, role: 'owner' } })
  if (created.error) throw created.error
  await insert('users', { id: created.data.user.id, org_id: orgId, email, name: label, role, active: true, password_hash: 'local-fixture' })
  const client = createClient(stack.url, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await client.auth.signInWithPassword({ email, password }); if (signed.error) throw signed.error
  return { token: signed.data.session!.access_token, id: created.data.user.id }
}
async function call(surface: 'backend' | 'frontend', path: string, method = 'GET', body?: unknown, credential = token) {
  requests++
  const response = await fetch((surface === 'backend' ? backendUrl + '/api/v1' : frontendUrl + '/api') + path, { method, headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
async function create(name = 'Release assistant', credential = token, surface: 'backend' | 'frontend' = 'backend') {
  const config = defaultAgentConfig(name, 'Use RELEASE_ONE and a calm tone.')
  const result = await call(surface, '/agents', 'POST', { name, config, org_id: b, orgId: b }, credential)
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return { id: result.body.data.id as string, config }
}
async function state(id: string, credential = token) {
  const agent = await call('backend', '/agents/' + id, 'GET', undefined, credential)
  const draft = await call('backend', '/agents/' + id + '/draft', 'GET', undefined, credential)
  expect(agent.status).toBe(200); expect(draft.status).toBe(200)
  return { expectedRevision: draft.body.data.revision as number, expectedPublishedVersionId: agent.body.data.published_version_id as string | null }
}
async function publish(id: string, credential = token, surface: 'backend' | 'frontend' = 'backend') {
  const revision = await state(id, credential)
  expect((await call(surface, '/agents/' + id + '/test', 'POST', revision, credential)).status).toBe(200)
  const result = await call(surface, '/agents/' + id + '/publish', 'POST', revision, credential)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return result.body.data.version as { id: string; version_number: number; config: AgentConfig }
}
async function snapshotB() {
  const snapshot: Record<string, unknown> = {}
  for (const table of tables) {
    const result = await admin.from(table).select('*').eq(table === 'organizations' ? 'id' : 'org_id', b)
    if (result.error) throw result.error
    snapshot[table] = result.data
  }
  return snapshot
}
beforeAll(async () => {
  const nativeFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { externalRequests++; throw new Error('External test request blocked') }
    return nativeFetch(input, init)
  })
  mkdirSync(output, { recursive: true })
  await insert('organizations', [{ id: a, name: 'Phase3 A', slug: 'phase3-a' }, { id: b, name: 'Phase3 B sentinel', slug: 'phase3-b' }])
  const identities = await Promise.all([identity('agent-a', a), identity('agent-b', b), identity('agent-viewer', a, 'viewer')])
  token = identities[0].token; actor = identities[0].id; bToken = identities[1].token; viewerToken = identities[2].token
  await insert('devices', [{ id: device, org_id: a, name: 'A channel' }, { id: unusedDevice, org_id: a, name: 'Unassigned channel' }, { id: bDevice, org_id: b, name: 'B private channel' }])
  await insert('knowledge_bases', [{ id: aKb, org_id: a, name: 'A knowledge' }, { id: bKb, org_id: b, name: 'B private knowledge' }])
  await insert('flows', { id: bFlow, org_id: b, name: 'B private flow' })
  server = await new Promise<Server>(done => { const listener = createApiApp(0).listen(0, '127.0.0.1', () => done(listener)) })
  backendUrl = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  next = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-p', '0', '-H', '127.0.0.1'], { cwd: resolve('frontend'), env: { ...process.env, NODE_ENV: 'production', BACKEND_URL: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next startup timed out')), 60000)
    const read = (chunk: Buffer) => { const text = chunk.toString(); logs.push(text); const match = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) frontendUrl = match[0]; if (/Ready in/.test(text)) { clearTimeout(timeout); done() } }
    next.stdout!.on('data', read); next.stderr!.on('data', read); next.on('exit', code => { clearTimeout(timeout); reject(new Error('Next exit ' + code)) })
  })
  const createdB = await create('Private B assistant', bToken)
  bAgent = createdB.id; bVersion = (await publish(bAgent, bToken)).id
  process.env.ANTHROPIC_API_KEY = 'phase3-local-stub-only'
  browser = await chromium.launch({ headless: true })
})
beforeEach(async () => { beforeB = await snapshotB(); transport.provider.mockClear(); transport.send.mockClear() })
afterEach(async () => {
  expect(await snapshotB()).toEqual(beforeB); expect(externalRequests).toBe(0); bChecks++
  writeFileSync(resolve(stack.directory, 'agent-progress.json'), JSON.stringify({ completed: bChecks, requests }))
})
afterAll(async () => {
  await browser?.close(); next?.kill()
  if (server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
  writeFileSync(resolve(stack.directory, 'agent-http-evidence.json'), JSON.stringify({ requests, tenantBSnapshotChecks: bChecks, snapshotTables: tables, externalRequests, browserErrors, providerAndGateway: 'stubbed in backend; frontend provider credentials removed', appliedToLiveProject: false }, null, 2))
  writeFileSync(resolve(stack.directory, 'agent-frontend.log'), logs.join(''))
  delete process.env.ANTHROPIC_API_KEY; vi.unstubAllGlobals()
})

describe.each(['backend', 'frontend'] as const)('%s version controls', surface => {
  it.each([['draft','GET'],['draft','PATCH'],['validate','POST'],['test','POST'],['publish','POST'],['versions','GET'],['channels','GET'],['activity','GET']])('rejects tenant B %s %s', async (suffix, method) => {
    const result = await call(surface, '/agents/' + bAgent + '/' + suffix, method, method === 'GET' ? undefined : { expectedRevision: 1, expectedPublishedVersionId: bVersion, config: defaultAgentConfig('attack') })
    expect(result.status).toBe(404)
  })
  it('rejects foreign version reads and rollback', async () => {
    const own = await create()
    expect((await call(surface, '/agents/' + own.id + '/versions/' + bVersion)).status).toBe(404)
    expect((await call(surface, '/agents/' + own.id + '/versions/' + bVersion + '/rollback', 'POST', await state(own.id))).status).toBe(404)
  })
  it('ignores forged organization fields and query filters', async () => {
    const own = await create('Owned by A', token, surface)
    const result = await call(surface, '/agents/' + own.id + '/draft?org_id=' + b + '&orgId=' + b)
    expect(result.status).toBe(200); expect(result.body.data.org_id).toBe(a)
    expect((await admin.from('agents').select('org_id').eq('id', own.id).single()).data?.org_id).toBe(a)
  })
  it.each(['knowledge', 'flow'])('rejects foreign %s before draft changes', async kind => {
    const own = await create()
    const revision = await state(own.id)
    const config = { ...own.config, knowledgeBaseIds: kind === 'knowledge' ? [bKb] : [], tools: kind === 'knowledge' ? ['knowledge.search'] : [], defaultFlowId: kind === 'flow' ? bFlow : null }
    expect((await call(surface, '/agents/' + own.id + '/draft', 'PATCH', { ...revision, config })).status).toBe(404)
    expect(await state(own.id)).toEqual(revision)
  })
  it('viewer cannot save, test, publish, create or assign channels', async () => {
    const own = await create()
    for (const [suffix, method, body] of [['draft','PATCH',{ ...await state(own.id), config: own.config }],['test','POST',await state(own.id)],['publish','POST',await state(own.id)],['channels','POST',{ deviceId: device }]] as const) expect((await call(surface, '/agents/' + own.id + '/' + suffix, method, body, viewerToken)).status).toBe(403)
    expect((await call(surface, '/agents', 'POST', { name: 'attack', config: own.config }, viewerToken)).status).toBe(403)
  })
})
it('requires mandatory tests, produces a diff, and never sends from draft test', async () => {
  const own = await create(), revision = await state(own.id)
  expect((await call('backend', '/agents/' + own.id + '/publish', 'POST', revision)).status).toBe(409)
  const validation = await call('backend', '/agents/' + own.id + '/validate', 'POST', {})
  expect(validation.body.data.diff.some((row: any) => row.field === 'instructions')).toBe(true)
  const test = await call('backend', '/agents/' + own.id + '/test', 'POST', revision)
  expect(test.status).toBe(200); expect(test.body.data.tests.every((row: any) => row.passed)).toBe(true)
  expect(test.body.data).toMatchObject({ providerCalls: 0, whatsappSends: 0 })
  expect(transport.provider).not.toHaveBeenCalled(); expect(transport.send).not.toHaveBeenCalled()
})
it('draft edits do not change actual WhatsApp replies; publish changes the next reply', async () => {
  const own = await create(), v1 = await publish(own.id)
  expect((await call('backend', '/agents/' + own.id + '/channels', 'POST', { deviceId: device })).status).toBe(200)
  const router = new MessageRouter()
  const message = () => ({ key: { id: randomUUID(), remoteJid: '971500000333@s.whatsapp.net', fromMe: false }, message: { conversation: 'Hello how are you today?' } })
  await router.routeMessage(device, a, message())
  expect(transport.send.mock.calls.at(-1)?.[0]).toMatchObject({ text: 'Verified configuration reply: RELEASE_ONE' })
  const revision = await state(own.id), config = { ...own.config, instructions: 'Use RELEASE_TWO and a concise tone.' }
  expect((await call('backend', '/agents/' + own.id + '/draft', 'PATCH', { ...revision, config })).status).toBe(200)
  await router.routeMessage(device, a, message())
  expect(transport.send.mock.calls.at(-1)?.[0]).toMatchObject({ text: 'Verified configuration reply: RELEASE_ONE' })
  const v2 = await publish(own.id)
  await router.routeMessage(device, a, message())
  expect(transport.send.mock.calls.at(-1)?.[0]).toMatchObject({ text: 'Verified configuration reply: RELEASE_TWO' })
  expect((await call('backend', '/agents/' + own.id + '/versions/' + v1.id)).body.data.config.instructions).toContain('RELEASE_ONE')
  const rows = await admin.from('messages').select('metadata').eq('org_id', a).eq('direction', 'outbound')
  expect(rows.data?.some(row => row.metadata.agentVersionId === v2.id)).toBe(true)
})
it('concurrent stale draft writes produce one winner and no overwritten winner', async () => {
  const own = await create(), revision = await state(own.id)
  const results = await Promise.all(['ONE','TWO'].map(marker => call('backend', '/agents/' + own.id + '/draft', 'PATCH', { ...revision, config: { ...own.config, instructions: 'Concurrent ' + marker } })))
  expect(results.map(row => row.status).sort()).toEqual([200,409])
  expect((await state(own.id)).expectedRevision).toBe(revision.expectedRevision + 1)
})
it('concurrent stale publishes atomically switch once and create exactly one version', async () => {
  const own = await create(), revision = await state(own.id)
  await call('backend', '/agents/' + own.id + '/test', 'POST', revision)
  const results = await Promise.all([call('backend', '/agents/' + own.id + '/publish', 'POST', revision), call('frontend', '/agents/' + own.id + '/publish', 'POST', revision)])
  expect(results.map(row => row.status).sort()).toEqual([200,409])
  const versions = await call('backend', '/agents/' + own.id + '/versions')
  expect(versions.body.data).toHaveLength(1)
  expect((await state(own.id)).expectedPublishedVersionId).toBe(versions.body.data[0].id)
})
it('saving after tests invalidates the receipt and a stale test cannot authorize a new draft', async () => {
  const own = await create(), revision = await state(own.id)
  await call('backend', '/agents/' + own.id + '/test', 'POST', revision)
  await call('backend', '/agents/' + own.id + '/draft', 'PATCH', { ...revision, config: { ...own.config, instructions: 'New draft' } })
  expect((await call('backend', '/agents/' + own.id + '/test', 'POST', revision)).status).toBe(409)
  expect((await call('backend', '/agents/' + own.id + '/publish', 'POST', await state(own.id))).status).toBe(409)
})
it('rollback creates a new version, preserves both historical snapshots and rejects stale restore', async () => {
  const own = await create(), first = await publish(own.id)
  await call('backend', '/agents/' + own.id + '/draft', 'PATCH', { ...await state(own.id), config: { ...own.config, instructions: 'RELEASE_TWO' } })
  const second = await publish(own.id), revision = await state(own.id)
  const rollback = await call('frontend', '/agents/' + own.id + '/versions/' + first.id + '/rollback', 'POST', revision)
  expect(rollback.status).toBe(200)
  expect(rollback.body.data.version).toMatchObject({ version_number: 3, parent_version_id: second.id, restored_from_version_id: first.id, config: first.config })
  expect(rollback.body.data.version.id).not.toBe(first.id)
  expect((await call('backend', '/agents/' + own.id + '/versions/' + first.id + '/rollback', 'POST', revision)).status).toBe(409)
  expect((await call('backend', '/agents/' + own.id + '/versions')).body.data).toHaveLength(3)
})
it('history, audit and normalized snapshots reject direct mutation; parent ownership rejects malformed links', async () => {
  const own = await create(), version = await publish(own.id)
  for (const operation of ['update', 'delete'] as const) {
    const result = operation === 'update' ? await admin.from('agent_versions').update({ config: defaultAgentConfig('attack') }).eq('id', version.id) : await admin.from('agent_versions').delete().eq('id', version.id)
    expect(result.error?.code).toBe('55000')
  }
  const audit = await admin.from('agent_config_events').update({ action: 'attack' }).eq('agent_id', own.id)
  expect(audit.error?.code).toBe('55000')
  expect((await admin.from('agent_channel_links').insert({ org_id: a, device_id: bDevice, agent_id: own.id })).error?.code).toBe('23503')
  expect((await admin.from('agent_version_knowledge_bases').insert({ org_id: a, agent_id: own.id, version_id: version.id, knowledge_base_id: bKb })).error?.code).toBe('55000')
  expect((await admin.from('agents').update({ published_version_id: bVersion }).eq('id', own.id)).error?.code).toBe('23503')
})
it.each(tables.filter(table => table.startsWith('agent_')))('authenticated REST cannot access %s', async table => {
  const client = createClient(stack.url, stack.anonKey, { global: { headers: { authorization: 'Bearer ' + token } }, auth: { persistSession: false } })
  const read = await client.from(table).select('*'), write = await client.from(table).delete().eq('org_id', b)
  expect(read.error).toBeTruthy(); expect(write.error).toBeTruthy()
})
it('authenticated users cannot invoke service-only control RPC or forge the stored actor', async () => {
  const own = await create(), payload = { p_org: a, p_actor: actor, p_agent: own.id, p_action: 'publish', p_payload: await state(own.id) }
  const client = createClient(stack.url, stack.anonKey, { global: { headers: { authorization: 'Bearer ' + token } }, auth: { persistSession: false } })
  expect((await client.rpc('mutate_agent_config', payload)).error).toBeTruthy()
  expect((await client.from('agents').update({ published_version_id: bVersion }).eq('id', own.id)).error).toBeTruthy()
  expect((await admin.rpc('mutate_agent_config', { ...payload, p_org: b })).error?.code).toBe('42501')
})
it('channel ownership, missing assignment and ambiguous candidates fail explicitly', async () => {
  const own = await create()
  expect((await call('frontend', '/agents/' + own.id + '/channels', 'POST', { deviceId: bDevice })).status).toBe(404)
  expect((await call('backend', '/agents/runtime/current?deviceId=' + bDevice)).status).toBe(404)
  expect((await call('backend', '/agents/runtime/current?deviceId=' + unusedDevice)).body.code).toBe('CHANNEL_AGENT_REQUIRED')
  await publish(own.id); await publish((await create('Second active')).id)
  const ambiguous = await call('frontend', '/agents/runtime/current')
  expect(ambiguous.status).toBe(409); expect(ambiguous.body.code).toBe('AMBIGUOUS_AGENT')
})
it('normalized knowledge links and server runtime follow only the published version', async () => {
  const own = await create(), config = { ...own.config, knowledgeBaseIds: [aKb], tools: ['knowledge.search'] }
  await call('frontend', '/agents/' + own.id + '/draft', 'PATCH', { ...await state(own.id), config })
  const version = await publish(own.id)
  await call('backend', '/agents/' + own.id + '/channels', 'POST', { deviceId: device })
  const runtime = await call('frontend', '/agents/runtime/current?deviceId=' + device + '&orgId=' + b)
  expect(runtime.body.data).toMatchObject({ orgId: a, publishedVersionId: version.id, config })
  expect((await admin.from('agent_version_knowledge_bases').select('knowledge_base_id').eq('version_id', version.id)).data).toEqual([{ knowledge_base_id: aKb }])
  expect((await admin.from('agent_version_tools').select('tool_key').eq('version_id', version.id)).data).toEqual([{ tool_key: 'knowledge.search' }])
  expect((await call('frontend', '/agents/' + own.id, 'DELETE')).status).toBe(409)
  const chunksBefore = await admin.from('knowledge_chunks').select('*').eq('knowledge_base_id', aKb).eq('org_id', a)
  expect((await call('frontend', '/knowledge-bases/' + aKb, 'DELETE')).status).toBe(409)
  expect((await admin.from('knowledge_chunks').select('*').eq('knowledge_base_id', aKb).eq('org_id', a)).data).toEqual(chunksBefore.data)
})

async function pageFor(credential: string, path: string, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme: 'light' })
  await context.addCookies([{ name: 'sb-access-token', value: credential, url: frontendUrl, httpOnly: true, sameSite: 'Lax' }])
  const page = await context.newPage(); page.on('pageerror', error => browserErrors.push(error.message))
  await page.goto(frontendUrl + path)
  return { context, page }
}
it('browser creates, edits, checks, publishes and reviews a historical restore', async () => {
  const { context, page } = await pageFor(token, '/ai-studio')
  try {
    await browserExpect(page.getByRole('heading', { name: 'AI Studio', exact: true })).toBeVisible()
    await page.getByLabel('New assistant name').fill('Browser concierge')
    await page.getByRole('button', { name: 'Create draft', exact: true }).click()
    await browserExpect(page.getByLabel('Assistant name', { exact: true })).toHaveValue('Browser concierge')
    await browserExpect(page.getByRole('button', { name: 'Publish version' })).toBeDisabled()
    await page.getByLabel('Instructions', { exact: true }).fill('Be thoughtful. Use RELEASE_BROWSER.')
    await browserExpect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await browserExpect(page.getByText('Draft saved', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Run checks', exact: true }).click()
    await browserExpect(page.getByText('Test completed.', { exact: true })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: resolve(output, 'studio-release-review-desktop.png'), fullPage: true })
    await page.getByRole('button', { name: 'Publish version', exact: true }).click()
    await browserExpect(page.getByText('Version 1', { exact: true })).toBeVisible()
    await page.reload(); await browserExpect(page.getByLabel('Instructions', { exact: true })).toHaveValue('Be thoughtful. Use RELEASE_BROWSER.')
    await page.getByRole('button', { name: 'Review restore', exact: true }).click()
    await page.getByRole('button', { name: 'Restore as new version', exact: true }).click()
    await browserExpect(page.getByText('Version 2', { exact: true })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: resolve(output, 'studio-history-desktop.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(browserErrors).toEqual([])
  } finally { await context.close() }
})
it('browser mobile fits, viewer is read-only, and foreign agent errors stay visible', async () => {
  const own = await create('Mobile assistant')
  const { context, page } = await pageFor(viewerToken, '/ai-studio/' + own.id, true)
  try {
    await browserExpect(page.getByLabel('Assistant name', { exact: true })).toBeDisabled()
    await browserExpect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(output, 'studio-mobile-viewer.png'), fullPage: true })
    await page.goto(frontendUrl + '/ai-studio/' + bAgent)
    await browserExpect(page.locator('p[role="alert"]')).toContainText('Agent was not found')
    expect(await page.locator('body').innerText()).not.toContain('Private B assistant')
  } finally { await context.close() }
})
