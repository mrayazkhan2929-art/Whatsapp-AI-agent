import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, expect as browserExpect, type Browser } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Server } from 'node:http'
import { createApiApp } from '../../backend/src/api/app'
import { companyProfileSchema } from '../../backend/src/modules/company/OrganizationProfileService'

const outbound = vi.hoisted(() => ({ send: vi.fn(() => { throw new Error('Outbound WhatsApp must not be called') }), provider: vi.fn(() => { throw new Error('Company answers must not invoke a provider') }) }))
vi.mock('../../backend/src/whatsapp/WhatsAppGateway', () => ({ whatsAppGateway: { sendText: outbound.send, getConnectedDeviceIds: () => [], getRuntimeSnapshotSummary: () => ({}) } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: outbound.provider } } }))
vi.mock('groq-sdk', () => ({ default: class { chat = { completions: { create: outbound.provider } } } }))
const config = JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!, 'utf8'))
const admin = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const password = 'Local-phase2-fixture-123!'
const a = randomUUID(), b = randomUUID(), empty = randomUUID(), conversation = randomUUID(), bConversation = randomUUID()
let server: Server, next: ChildProcess, browser: Browser, backendUrl: string, frontendUrl: string
let token: string, bToken: string, viewerToken: string, emptyToken: string
let beforeB: unknown, requests = 0, bChecks = 0
let externalRequests = 0
const output = resolve(process.env.PHASE_REPORT_DIR ?? 'docs/phase2/artifacts')
const logs: string[] = []
const errors: string[] = []
const profiles = {
  a: companyProfileSchema.parse({ legal_name: 'Northstar Realty', short_name: 'Northstar', description: 'Thoughtful property guidance, built around you.', logo_url: 'https://a.example.invalid/logo.svg', office_address: '18 Harbour Avenue, Dubai', map_url: 'https://maps.example.invalid/northstar', website: 'https://northstar.example.invalid', email: 'hello@northstar.example.invalid', phone: '+97111111111', whatsapp: '+97111111112', timezone: 'Asia/Dubai', working_hours: { summary: 'Monday–Friday, 9:00–18:00' }, service_areas: ['Dubai Marina', 'Downtown Dubai'], license_number: 'A-100', license_authority: 'A Authority', social_links: { LinkedIn: 'https://social.example.invalid/northstar' }, company_facts: { owner: 'Northstar owner' }, legal_disclaimer: 'Availability is subject to confirmation.', approved_marketing_statements: ['Local insight. Personal service.'] }),
  b: companyProfileSchema.parse({ legal_name: 'Cedar & Co', short_name: 'Cedar', description: 'Tenant B private company description', logo_url: 'https://b.example.invalid/logo.svg', office_address: '92 Cedar Street, London', map_url: 'https://maps.example.invalid/cedar', website: 'https://cedar.example.invalid', email: 'hello@cedar.example.invalid', phone: '+44222222222', timezone: 'Europe/London', working_hours: { summary: 'Tuesday–Saturday, 10:00–17:00' }, service_areas: ['London'], license_number: 'B-200', license_authority: 'B Authority', company_facts: { owner: 'Cedar owner' }, legal_disclaimer: 'Cedar disclaimer', approved_marketing_statements: ['Cedar verified statement'] }),
}
async function insert(table: string, rows: unknown) { const result = await admin.from(table).insert(rows as any); if (result.error) throw result.error }
async function identity(label: string, orgId: string, role = 'admin') {
  const email = label + '@phase2.example.invalid'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { org_id: b, role: 'owner' }, user_metadata: { org_id: b } })
  if (created.error) throw created.error
  await insert('users', { id: created.data.user.id, org_id: orgId, email, name: label, role, active: true, password_hash: 'local-fixture' })
  const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await client.auth.signInWithPassword({ email, password }); if (login.error) throw login.error
  return login.data.session!.access_token
}
async function call(surface: 'backend' | 'frontend', path: string, method = 'GET', body?: unknown, credential = token) {
  requests++
  const response = await fetch((surface === 'backend' ? backendUrl + '/api/v1' : frontendUrl + '/api') + path, { method, headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const raw = await response.text()
  let payload: any
  try { payload = JSON.parse(raw) } catch { payload = { nonJsonResponse: true } }
  return { response, body: payload }
}
async function snapshotB() {
  const snapshot: Record<string, unknown> = {}
  for (const table of ['organization_profiles', 'users', 'organizations', 'contacts', 'conversations', 'messages']) {
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
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { externalRequests++; throw new Error('External test network request blocked') }
    return nativeFetch(input, init)
  })
  mkdirSync(output, { recursive: true })
  await insert('organizations', [{ id: a, name: 'Profile A fixture', slug: 'phase2-a' }, { id: b, name: 'Profile B fixture', slug: 'phase2-b' }, { id: empty, name: 'Unconfigured fixture', slug: 'phase2-empty' }])
  ;[token, bToken, viewerToken, emptyToken] = await Promise.all([identity('profile-a', a), identity('profile-b', b), identity('profile-viewer', a, 'viewer'), identity('profile-empty', empty)])
  await insert('organization_profiles', [{ ...profiles.a, org_id: a }, { ...profiles.b, org_id: b }])
  for (const [org, id, phone] of [[a, conversation, '+3111111'], [b, bConversation, '+3222222']]) {
    const contact = randomUUID()
    await insert('contacts', { id: contact, org_id: org, phone })
    await insert('conversations', { id, org_id: org, contact_id: contact })
  }
  server = await new Promise<Server>(done => { const listener = createApiApp(0).listen(0, '127.0.0.1', () => done(listener)) })
  backendUrl = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  next = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-p', '0', '-H', '127.0.0.1'], { cwd: resolve('frontend'), env: { ...process.env, NODE_ENV: 'production', BACKEND_URL: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next startup timed out')), 60000)
    const read = (chunk: Buffer) => { const text = chunk.toString(); logs.push(text); const match = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) frontendUrl = match[0]; if (/Ready in/.test(text)) { clearTimeout(timeout); done() } }
    next.stdout!.on('data', read); next.stderr!.on('data', read); next.on('exit', code => { clearTimeout(timeout); reject(new Error('Next exit ' + code)) })
  })
  browser = await chromium.launch({ headless: true })
})
beforeEach(async () => { beforeB = await snapshotB() })
afterEach(async () => { expect(await snapshotB()).toEqual(beforeB); expect(outbound.send).not.toHaveBeenCalled(); expect(outbound.provider).not.toHaveBeenCalled(); expect(externalRequests).toBe(0); bChecks++ })
afterAll(async () => {
  await browser?.close()
  next?.kill()
  if (server) await new Promise<void>(done => server.close(() => done()))
  writeFileSync(resolve(config.directory, 'company-http-evidence.json'), JSON.stringify({ requests, tenantBSnapshotChecks: bChecks, snapshotTables: ['organization_profiles', 'users', 'organizations', 'contacts', 'conversations', 'messages'], browserErrors: errors, providerCalls: outbound.provider.mock.calls.length, whatsAppCalls: outbound.send.mock.calls.length, externalBackendRequests: externalRequests, frontendProviderCredentials: 'removed by harness', appliedToLiveProject: false }, null, 2))
  writeFileSync(resolve(config.directory, 'company-frontend.log'), logs.join(''))
  vi.unstubAllGlobals()
})

describe.each(['backend', 'frontend'] as const)('%s company API', surface => {
  it('reads only the resolved tenant and ignores forged query IDs', async () => {
    const result = await call(surface, '/settings/company-profile?org_id=' + b + '&orgId=' + b)
    expect(result.response.status).toBe(200)
    expect(result.body.data).toMatchObject({ org_id: a, legal_name: profiles.a.legal_name, logo_url: profiles.a.logo_url })
    expect(JSON.stringify(result.body)).not.toContain('Cedar')
  })
  it.each(['office address', 'company phone', 'company website', 'company logo', 'working hours', 'Tell me about your company', 'ما هو عنوان المكتب؟', 'ما هي معلومات الشركة؟', 'ما هو رقم الهاتف؟', 'Who is your CEO?', 'Who is the owner of your company?'])('same question uses distinct A/B facts: %s', async message => {
    const first = await call(surface, '/chat', 'POST', { message, org_id: b, orgId: b })
    const second = await call(surface, '/chat', 'POST', { message }, bToken)
    expect(first.response.status, JSON.stringify(first.body)).toBe(200)
    expect(second.response.status, JSON.stringify(second.body)).toBe(200)
    expect(first.body.reply).toContain(/ceo/i.test(message) ? 'not been configured' : /owner/i.test(message) ? profiles.a.company_facts.owner : profiles.a.legal_name)
    expect(second.body.reply).toContain(/ceo/i.test(message) ? 'not been configured' : /owner/i.test(message) ? profiles.b.company_facts.owner : profiles.b.legal_name)
    expect(first.body.reply).not.toMatch(/Cedar|44222222222|92 Cedar Street|b\.example\.invalid|Investment Experts|Concord Tower/)
    expect(second.body.reply).not.toMatch(/Northstar|97111111111|18 Harbour Avenue|a\.example\.invalid|Investment Experts|Concord Tower/)
  })
  it('requires admin authorization before writing a profile', async () => {
    const before = (await admin.from('organization_profiles').select('*').eq('org_id', a).single()).data
    const denied = await call(surface, '/settings/company-profile', 'PATCH', { ...profiles.a, legal_name: 'attack' }, viewerToken)
    expect(denied.response.status).toBe(403)
    expect((await admin.from('organization_profiles').select('*').eq('org_id', a).single()).data).toEqual(before)
    expect((await call(surface, '/settings/company-profile', 'GET', undefined, viewerToken)).response.status).toBe(200)
  })
  it('writes only A despite forged body IDs, and uses the next saved values immediately', async () => {
    const saved = await call(surface, '/settings/company-profile?org_id=' + b, 'PATCH', { ...profiles.a, office_address: 'Updated Northstar address', org_id: b, orgId: b, created_at: 'forged' })
    expect(saved.response.status).toBe(200)
    expect(saved.body.data.org_id).toBe(a)
    expect(saved.body.data.created_at).not.toBe('forged')
    expect((await call(surface, '/chat', 'POST', { message: 'office address' })).body.reply).toContain('Updated Northstar address')
  })
  it('handles missing profiles honestly without legacy fallback or automatic backfill', async () => {
    expect((await call(surface, '/settings/company-profile', 'GET', undefined, emptyToken)).body.data).toBeNull()
    const answer = await call(surface, '/chat', 'POST', { message: 'office address' }, emptyToken)
    expect(answer.response.status).toBe(200)
    expect(answer.body.reply).toContain('not been configured')
    expect((await admin.from('organization_profiles').select('*').eq('org_id', empty)).data).toEqual([])
  })
  it('rejects unsafe links and missing identity without changing any rows', async () => {
    const invalid = await call(surface, '/settings/company-profile', 'PATCH', { ...profiles.a, logo_url: 'javascript:alert(1)' })
    expect(invalid.response.status).toBe(400)
    expect((await call(surface, '/settings/company-profile', 'GET', undefined, 'forged')).response.status).toBe(401)
    expect((await call(surface, '/settings/company-profile/' + b)).response.status).toBe(404)
  })
  it('rejects a foreign conversation before persisting a company reply', async () => {
    expect((await call(surface, '/chat', 'POST', { message: 'office address', conversationId: bConversation })).response.status).toBe(404)
  })
})
it('persists a company reply under its own conversation and tenant', async () => {
  expect((await call('frontend', '/chat', 'POST', { message: 'office address', conversationId: conversation })).response.status).toBe(200)
  const rows = await admin.from('messages').select('*').eq('conversation_id', conversation)
  expect(rows.data).toHaveLength(1)
  expect(rows.data![0]).toMatchObject({ org_id: a, sender_type: 'ai' })
  expect(rows.data![0].content).toContain('Updated Northstar address')
})
it('denies direct REST profile reads and writes to anonymous and authenticated clients', async () => {
  for (const credential of [undefined, token]) {
    const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: credential ? { headers: { Authorization: 'Bearer ' + credential } } : undefined })
    for (const query of [client.from('organization_profiles').select('*').eq('org_id', b), client.from('organization_profiles').update({ legal_name: 'attack' }).eq('org_id', b).select('*'), client.from('organization_profiles').insert({ org_id: empty, legal_name: 'attack' }).select('*'), client.from('organization_profiles').delete().eq('org_id', b).select('*')]) {
      const result = await query
      expect(result.error?.code).toBe('42501')
      expect(result.data).toBeNull()
    }
  }
})

async function openProfile(credential: string, mobile = false, record = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme: 'light', recordVideo: record ? { dir: output, size: { width: 1440, height: 1000 } } : undefined })
  await context.addCookies([{ name: 'sb-access-token', value: credential, url: frontendUrl, httpOnly: true, sameSite: 'Lax' }])
  await context.route('https://a.example.invalid/logo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="18" fill="#059669"/><text x="50" y="66" text-anchor="middle" font-size="55" fill="white">N</text></svg>' }))
  await context.route('https://b.example.invalid/logo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="18" fill="#2563eb"/><text x="50" y="66" text-anchor="middle" font-size="55" fill="white">C</text></svg>' }))
  await context.route('https://www.investmentexperts.ae/**', route => route.abort())
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(frontendUrl + '/settings')
  await browserExpect(page.getByRole('heading', { name: 'Company profile', exact: true })).toBeVisible()
  try { await browserExpect(page.getByLabel('Company name', { exact: true })).toBeVisible() }
  catch (error) { await page.screenshot({ path: resolve(output, 'profile-load-failure.png'), fullPage: true }); await context.close(); throw error }
  return { context, page }
}
it('browser edits, previews, saves and reloads all company sections', async () => {
  const { context, page } = await openProfile(token, false, true)
  try {
    await browserExpect(page.getByLabel('Company name', { exact: true })).toHaveValue('Northstar Realty')
    await page.getByLabel('Brand name', { exact: true }).fill('Northstar Collective')
    await browserExpect(page.getByRole('heading', { name: 'Northstar Collective' })).toBeVisible()
    await browserExpect(page.getByText('Unsaved changes', { exact: true })).toBeVisible()
    await page.screenshot({ path: resolve(output, 'company-identity-desktop.png'), fullPage: true })
    await page.getByRole('tab', { name: 'Contact', exact: true }).click()
    await page.getByLabel('Office address', { exact: true }).fill('24 Harbour Avenue, Dubai')
    await page.getByLabel('Email', { exact: true }).fill('team@northstar.example.invalid')
    await page.getByRole('tab', { name: 'Operations', exact: true }).click()
    await page.getByLabel('Working hours', { exact: true }).fill('Monday–Saturday, 8:30–18:30')
    await page.getByLabel('Service areas', { exact: true }).fill('Dubai Marina\nDowntown Dubai\nBusiness Bay')
    await page.getByRole('tab', { name: 'Trust & facts', exact: true }).click()
    await page.getByLabel('License number', { exact: true }).fill('A-101')
    await page.getByLabel('Approved marketing statements', { exact: true }).fill('Local insight. Personal service.\nA team that knows your neighbourhood.')
    await page.screenshot({ path: resolve(output, 'company-trust-desktop.png'), fullPage: true })
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await browserExpect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    await browserExpect(page.locator('[data-sidebar="header"]')).toContainText('Northstar Collective')
    await page.reload()
    await browserExpect(page.getByLabel('Brand name', { exact: true })).toHaveValue('Northstar Collective')
    expect((await call('backend', '/chat', 'POST', { message: 'office address' })).body.reply).toContain('24 Harbour Avenue')
    await page.screenshot({ path: resolve(output, 'company-saved-desktop.png'), fullPage: true })
    expect(await page.getByLabel('Company name', { exact: true }).getAttribute('id')).toBeTruthy()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally { const video = page.video(); await context.close(); if (video) { await video.saveAs(resolve(output, 'company-profile-walkthrough.webm')); await video.delete() } }
})
it('browser mobile is responsive and keyboard tabs expose accessible fields', async () => {
  const { context, page } = await openProfile(token, true)
  try {
    await page.getByRole('tab', { name: 'Contact', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await browserExpect(page.getByRole('tab', { name: 'Operations', exact: true })).toHaveAttribute('aria-selected', 'true')
    await browserExpect(page.getByLabel('Timezone', { exact: true })).toHaveValue('Asia/Dubai')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(output, 'company-mobile.png'), fullPage: true })
  } finally { await context.close() }
})
it('browser viewer cannot edit, and tenant B sees only its own brand and logo', async () => {
  for (const [credential, readOnly, expectedBrand] of [[viewerToken, true, 'Northstar Realty'], [bToken, false, 'Cedar & Co']] as const) {
    const { context, page } = await openProfile(credential)
    try {
      await browserExpect(page.getByLabel('Company name', { exact: true })).toHaveValue(expectedBrand)
      if (readOnly) { await browserExpect(page.getByLabel('Company name', { exact: true })).toBeDisabled(); await browserExpect(page.getByRole('button', { name: 'Save profile', exact: true })).toHaveCount(0) }
      else { expect(await page.locator('body').innerText()).not.toContain('Northstar'); await browserExpect(page.locator('[data-sidebar="header"] img')).toHaveAttribute('src', profiles.b.logo_url); await page.screenshot({ path: resolve(output, 'company-tenant-b.png'), fullPage: true }) }
    } finally { await context.close() }
  }
})
it('browser validation, discard and retry keep errors visible and draft safe', async () => {
  const { context, page } = await openProfile(token)
  try {
    await page.getByLabel('Company name', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await browserExpect(page.locator('form').getByRole('alert')).toContainText('Company name is required')
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await browserExpect(page.getByLabel('Company name', { exact: true })).toHaveValue('Northstar Realty')
    await page.route('**/api/settings/company-profile', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Local fixture save failed' } }) }) : route.continue())
    await page.getByLabel('Brand name', { exact: true }).fill('Draft to retain')
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await browserExpect(page.locator('form').getByRole('alert')).toContainText('Local fixture save failed')
    await browserExpect(page.getByLabel('Brand name', { exact: true })).toHaveValue('Draft to retain')
    await page.unroute('**/api/settings/company-profile')
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await browserExpect(page.getByText('All changes saved', { exact: true })).toBeVisible()
  } finally { await context.close() }
})
it('browser creates an unconfigured tenant profile using only entered facts', async () => {
  const { context, page } = await openProfile(emptyToken)
  try {
    await browserExpect(page.getByLabel('Company name', { exact: true })).toHaveValue('')
    await browserExpect(page.getByText('Ready to configure', { exact: true })).toBeVisible()
    await page.getByLabel('Company name', { exact: true }).fill('New company workspace')
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await browserExpect(page.getByText('All changes saved', { exact: true })).toBeVisible()
    const result = await call('backend', '/settings/company-profile', 'GET', undefined, emptyToken)
    expect(result.body.data).toMatchObject({ org_id: empty, legal_name: 'New company workspace', office_address: '', phone: '', logo_url: '' })
    expect(JSON.stringify(result.body)).not.toMatch(/Investment Experts|Concord|Northstar|Cedar/)
  } finally { await context.close() }
})
