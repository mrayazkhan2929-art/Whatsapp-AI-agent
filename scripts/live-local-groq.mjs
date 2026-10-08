// Uses authenticated application APIs and the real configured Groq gateway.
// Playground calls are read-only; this script sends no WhatsApp messages.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultAgentConfig } from '../backend/dist/modules/config/AgentVersionService.js'
import { defaultPropertyPolicy, emptyInstructionPolicy } from '../backend/dist/modules/config/AgentStudioPolicy.js'
const directory = resolve(import.meta.dirname, '../test-results/live-local')
const config = JSON.parse(readFileSync(resolve(directory, 'private-config.json'), 'utf8'))
const status = JSON.parse(readFileSync(resolve(directory, 'status.json'), 'utf8'))
if (status.status !== 'running' || !status.configuredProviders?.includes('GROQ_API_KEY')) throw Error('Restart the runtime after saving the private Groq key')
const base = status.frontendUrl
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ email: config.email, password: config.ownerPassword }) })
if (!login.ok) throw Error('Local login failed: ' + login.status)
const headers = { cookie: login.headers.getSetCookie().filter(value => !value.includes('Max-Age=0')).map(value => value.split(';')[0]).join('; '), origin: base, 'content-type': 'application/json' }
const call = async (path, method = 'GET', payload) => {
  const response = await fetch(base + '/api/agents' + path, { method, headers, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(30000) })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw Error('Agent API failed: ' + path + ' (' + response.status + ') ' + (body?.code ?? ''))
  return body.data ?? body
}
const agentPath = resolve(directory, 'groq-agent.json')
let agent
if (existsSync(agentPath)) agent = JSON.parse(readFileSync(agentPath, 'utf8'))
else {
  const draft = { ...defaultAgentConfig('Local Groq test assistant', 'You are a local test assistant. Reply briefly in the language used by the person. Acknowledge test messages clearly. Use only verified company or property facts; explain when they have not been configured. Never claim a booking, transfer, delivery, or external action unless it actually happened.'), studioVersion: 1, companyInheritance: 'authoritative', instructionPolicy: emptyInstructionPolicy, propertyPolicy: defaultPropertyPolicy, handoffPolicy: { automatic: true, onNoMatch: false, defaultMemberId: null } }
  draft.identity = { ...draft.identity, displayName: 'Test assistant', defaultLanguage: 'en', responseLength: 'short', tone: 'calm', emojiStyle: 'none' }
  draft.modelPolicy = { provider: 'groq', model: 'openai/gpt-oss-120b', temperature: 0.6, maxTokens: 1000, fallbackPolicy: 'safe-response' }
  agent = await call('', 'POST', { name: draft.identity.name, config: draft })
  writeFileSync(agentPath, JSON.stringify({ id: agent.id }, null, 2))
}
const before = await call('/' + agent.id), draft = await call('/' + agent.id + '/draft')
const revision = { expectedRevision: draft.revision, expectedPublishedVersionId: before.publishedVersionId ?? before.published_version_id ?? null }
const validation = await call('/' + agent.id + '/validate', 'POST', {})
const results = []
for (const message of ['Explain what a connection test checks in one short sentence.', 'اشرح باختصار ما الذي يتحقق منه اختبار الاتصال.']) {
  const response = await call('/' + agent.id + '/playground', 'POST', { expectedRevision: draft.revision, message, state: { excludeRefs: [] }, mode: 'model' })
  const live = response.provider === 'groq' && response.model === 'openai/gpt-oss-120b' && typeof response.finalResponse === 'string' && response.finalResponse.length > 0
  results.push({ language: /[\u0600-\u06ff]/.test(message) ? 'ar' : 'en', provider: response.provider, model: response.model, accepted: live, responseLength: response.finalResponse?.length ?? 0, sideEffects: response.sideEffects })
  if (!live) { writeFileSync(resolve(directory, 'groq-verification.json'), JSON.stringify({ results, published: false }, null, 2)); throw Error('Groq response was unavailable or rejected; see the agent playground trace. No placeholder response was accepted as a provider result.') }
}
const tested = await call('/' + agent.id + '/test', 'POST', revision)
const published = await call('/' + agent.id + '/publish', 'POST', revision)
const devices = await fetch(base + '/api/devices', { headers })
if (!devices.ok) throw Error('Device lookup unavailable: ' + devices.status)
const paired = (await devices.json()).data.filter(device => device.isLiveConnected)
if (paired.length !== 1) throw Error('Expected exactly one live local phone; select the intended channel in AI Studio')
await call('/' + agent.id + '/channels', 'POST', { deviceId: paired[0].id })
const evidence = { at: new Date().toISOString(), agentId: agent.id, model: 'openai/gpt-oss-120b', results, mandatoryChecks: tested.tests?.length, published: Boolean(published.publishedVersionId), channelDeviceId: paired[0].id, whatsappMessagesSentByScript: 0, physicalMessageRoundTripVerified: false }
writeFileSync(resolve(directory, 'groq-verification.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence))
