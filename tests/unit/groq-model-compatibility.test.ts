import { afterEach, expect, it, vi } from 'vitest'
import { agentConfigSchema, defaultAgentConfig } from '../../backend/src/modules/config/AgentVersionService'
import { selectedModel, preferredProvider } from '../../backend/src/modules/config/AgentStudioPolicy'
import { upgradeStudioConfig } from '../../frontend/src/lib/agent-studio'
const calls = vi.hoisted(() => ({ groq: vi.fn(async () => ({ choices: [{ message: { content: 'Hello. How can I help?', reasoning: 'private reasoning' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } })), anthropic: vi.fn() }))
vi.mock('groq-sdk', () => ({ default: class { chat = { completions: { create: calls.groq } } } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: calls.anthropic } } }))
vi.mock('../../backend/src/config/supabase', () => ({ isSupabaseConfigured: () => false, getSupabaseAdmin: () => { throw Error('No database expected') } }))
import { ModelGateway } from '../../backend/src/modules/ai/ModelGateway'
const config = () => upgradeStudioConfig(defaultAgentConfig('Local test assistant'))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
it.each(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'] as const)('accepts and selects Groq model %s', model => {
  const draft = config(); draft.modelPolicy = { ...draft.modelPolicy, provider: 'auto', model }
  expect(agentConfigSchema.safeParse(draft).success).toBe(true)
  expect(preferredProvider(draft.modelPolicy)).toBe('groq')
  expect(selectedModel(draft.modelPolicy, 'groq')).toBe(model)
})
it.each(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'] as const)('rejects %s with Anthropic credentials', model => {
  const draft = config(); draft.modelPolicy = { ...draft.modelPolicy, provider: 'anthropic', model }
  expect(agentConfigSchema.safeParse(draft).success).toBe(false)
})
it('retains an explicit historical enterprise Llama snapshot without mutating it', () => {
  const draft = config(); draft.modelPolicy = { ...draft.modelPolicy, provider: 'groq', model: 'llama-3.3-70b-versatile' }
  const before = JSON.stringify(draft)
  expect(agentConfigSchema.safeParse(draft).success).toBe(true)
  expect(selectedModel(draft.modelPolicy, 'groq')).toBe('llama-3.3-70b-versatile')
  expect(JSON.stringify(draft)).toBe(before)
})
it('uses supported automatic Groq defaults and preserves Anthropic selection', () => {
  const policy = config().modelPolicy
  expect(selectedModel(policy, 'groq')).toBe('openai/gpt-oss-120b')
  expect(selectedModel({ ...policy, latencyPreference: 'fast' }, 'groq')).toBe('openai/gpt-oss-20b')
  expect(selectedModel({ ...policy, costPreference: 'economy', qualityPreference: 'high' }, 'groq')).toBe('openai/gpt-oss-120b')
  expect(selectedModel(policy, 'anthropic')).toBe('claude-sonnet-4-20250514')
})
it('bounds the completion and excludes reasoning in the actual Groq SDK request', async () => {
  vi.stubEnv('GROQ_API_KEY', 'local-test-only')
  const draft = config(); draft.modelPolicy = { ...draft.modelPolicy, provider: 'groq', model: 'openai/gpt-oss-20b' }
  const result = await new ModelGateway().complete({ config: draft, system: 'Use verified facts.', messages: [{ role: 'user', content: 'Hello' }], route: { lang: 'en', lane: 'GENERAL', propertiesFound: 0 } })
  const request = (calls.groq.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]
  expect(request).toMatchObject({ model: 'openai/gpt-oss-20b', max_completion_tokens: 1000, include_reasoning: false, reasoning_effort: 'low' })
  expect(request).not.toHaveProperty('max_tokens')
  expect(result.reply).toBe('Hello. How can I help?')
  expect(JSON.stringify(result)).not.toContain('private reasoning')
  expect(calls.anthropic).not.toHaveBeenCalled()
})
it('still rejects arbitrary model IDs', () => {
  const draft = config()
  expect(agentConfigSchema.safeParse({ ...draft, modelPolicy: { ...draft.modelPolicy, model: 'attacker/model' } }).success).toBe(false)
})
