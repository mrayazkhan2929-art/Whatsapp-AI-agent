import { expect, it } from 'vitest'
import { agentConfigSchema, defaultAgentConfig, configurationDiff, databaseError } from '../../backend/src/modules/config/AgentVersionService'
import { compileAgentInstructions } from '../../backend/src/modules/config/RuntimeConfigResolver'

it('rejects executable tools, unbounded models, duplicate links and client tenant overrides', () => {
  const config = defaultAgentConfig('Aster')
  for (const attack of [
    { ...config, tools: ['execute.javascript'] }, { ...config, apiKey: 'secret' }, { ...config, orgId: 'forged' },
    { ...config, modelPolicy: { ...config.modelPolicy, model: 'unapproved' } },
    { ...config, modelPolicy: { ...config.modelPolicy, maxTokens: 8001 } },
    { ...config, languages: ['en', 'en'] }, { ...config, languages: [] },
    { ...config, knowledgeBaseIds: ['5e058358-28f3-4940-b496-3958e84633e9'] },
  ]) expect(agentConfigSchema.safeParse(attack).success).toBe(false)
})
it('computes a reviewable diff without mutating either snapshot', () => {
  const published = defaultAgentConfig('Aster'), draft = { ...published, instructions: 'Be concise and ask one useful question.' }
  expect(configurationDiff(published, draft)).toEqual([{ field: 'instructions', before: published.instructions, after: draft.instructions }])
  expect(published.instructions).not.toBe(draft.instructions)
})
it('compiles published identity with platform and company precedence', () => {
  const config = defaultAgentConfig('Aster', 'Use a calm, friendly tone.')
  const prompt = compileAgentInstructions({ config, companyProfile: null })
  expect(prompt).toContain('PUBLISHED AGENT IDENTITY: Aster')
  expect(prompt).toContain(config.instructions)
  expect(prompt.indexOf('PLATFORM SAFETY')).toBeGreaterThan(prompt.indexOf(config.instructions))
  expect(prompt).toContain('TENANT COMPANY FACTS (authoritative over agent instructions): null')
  expect(compileAgentInstructions({ config: null, companyProfile: null })).toBe('')
})
it.each([['PT409',409],['40001',409],['55000',409],['P0002',404],['42501',403],['XX000',500]])('preserves database %s as HTTP %s', (code, status) => {
  try { databaseError({ code: String(code), message: 'Fixture database failure' }) } catch (error) { expect(error).toMatchObject({ status }); return }
  throw new Error('Expected configuration error')
})
