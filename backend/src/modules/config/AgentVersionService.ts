import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getSupabaseAdmin } from '../../config/supabase.js'
import {identitySchema,instructionPolicySchema,propertyPolicySchema,handoffPolicySchema,modelPolicySchema,approvedTools,groqModelIds} from './AgentStudioPolicy.js'

export const agentConfigSchema = z.object({
  schemaVersion: z.literal(1),
  identity: identitySchema,
  instructions: z.string().trim().min(1).max(12000),
  languages: z.array(z.enum(['en', 'ar'])).min(1).max(2),
  modelPolicy: modelPolicySchema,
  knowledgeBaseIds: z.array(z.string().uuid()).max(10),
  defaultFlowId: z.string().uuid().nullable(),
  tools: z.array(z.enum(approvedTools)).max(12),
  studioVersion:z.literal(1).optional(),
  instructionPolicy:instructionPolicySchema.optional(),
  propertyPolicy:propertyPolicySchema.optional(),
  companyInheritance:z.literal('authoritative').optional(),
  handoffPolicy:handoffPolicySchema.optional(),
}).strict().superRefine((value, context) => {
  for (const key of ['languages', 'knowledgeBaseIds', 'tools'] as const) {
    if (new Set(value[key]).size !== value[key].length) context.addIssue({ code: 'custom', message: `${key} contains duplicates` })
  }
  if (value.knowledgeBaseIds.length && !value.tools.includes('knowledge.search')) context.addIssue({ code: 'custom', message: 'Enable knowledge.search when linking knowledge bases' })
  if(value.identity.defaultLanguage&&!value.languages.includes(value.identity.defaultLanguage))context.addIssue({code:'custom',message:'Default language must be supported'})
  if(value.modelPolicy.model==='claude-sonnet-4-20250514'&&value.modelPolicy.provider==='groq'||value.modelPolicy.model&&groqModelIds.includes(value.modelPolicy.model)&&value.modelPolicy.provider==='anthropic')context.addIssue({code:'custom',message:'Model and provider must agree'})
  if(value.studioVersion&&(!value.propertyPolicy||!value.instructionPolicy||!value.handoffPolicy))context.addIssue({code:'custom',message:'Complete the studio policy sections'})
  if(!value.studioVersion&&(value.propertyPolicy||value.instructionPolicy||value.handoffPolicy||value.tools.some(t=>t!=='knowledge.search')||Object.keys(value.identity).length>1||Object.keys(value.modelPolicy).length>3))context.addIssue({code:'custom',message:'Expanded configuration requires studioVersion 1'})
})
export type AgentConfig = z.infer<typeof agentConfigSchema>
export interface AgentVersion { id: string; org_id: string; agent_id: string; version_number: number; config: AgentConfig; parent_version_id: string | null; restored_from_version_id: string | null; published_at: string }
export interface AgentDraft { agent_id: string; org_id: string; config: AgentConfig; revision: number; tested_revision: number | null }
export class ConfigError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}
export function databaseError(error: { code?: string; message: string }): never {
  const status = error.code === 'P0002' ? 404 : error.code === '42501' ? 403 : ['PT409', '40001', '55000', '23505'].includes(error.code ?? '') ? 409 : 500
  throw new ConfigError(status, status === 409 ? 'CONFIG_CONFLICT' : status === 404 ? 'RESOURCE_NOT_FOUND' : status === 403 ? 'FORBIDDEN' : 'CONFIG_DATABASE_FAILED', status === 500 ? 'Agent configuration database operation failed' : error.message)
}
export function defaultAgentConfig(name: string, instructions = 'Help customers using verified company and property information.'): AgentConfig {
  return { schemaVersion: 1, identity: { name }, instructions, languages: ['en', 'ar'], modelPolicy: { provider: 'auto', temperature: 0.7, maxTokens: 1000 }, knowledgeBaseIds: [], defaultFlowId: null, tools: [] }
}
export function configurationDiff(before: AgentConfig | null, after: AgentConfig) {
  return (Object.keys(after) as Array<keyof AgentConfig>).filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after[key])).map(key => ({ field: key, before: before?.[key] ?? null, after: after[key] }))
}
export class AgentVersionService {
  async agent(orgId: string, id: string) {
    const { data, error } = await getSupabaseAdmin().from('agents').select('*').eq('org_id', orgId).eq('id', id).maybeSingle()
    if (error) databaseError(error)
    if (!data) throw new ConfigError(404, 'AGENT_NOT_FOUND', 'Agent was not found')
    return data as { id: string; org_id: string; name: string; active: boolean; published_version_id: string | null }
  }
  async draft(orgId: string, id: string): Promise<AgentDraft> {
    await this.agent(orgId, id)
    const { data, error } = await getSupabaseAdmin().from('agent_drafts').select('*').eq('org_id', orgId).eq('agent_id', id).maybeSingle()
    if (error) databaseError(error)
    if (!data) throw new ConfigError(409, 'DRAFT_NOT_INITIALIZED', 'This legacy agent needs an administrator to initialize a versioned draft')
    return data as AgentDraft
  }
  async version(orgId: string, agentId: string, id: string): Promise<AgentVersion> {
    await this.agent(orgId, agentId)
    const { data, error } = await getSupabaseAdmin().from('agent_versions').select('*').eq('org_id', orgId).eq('agent_id', agentId).eq('id', id).maybeSingle()
    if (error) databaseError(error)
    if (!data) throw new ConfigError(404, 'VERSION_NOT_FOUND', 'Version was not found')
    return data as AgentVersion
  }
  async references(orgId: string, config: AgentConfig) {
    for (const [table, ids] of [['knowledge_bases', config.knowledgeBaseIds], ['flows', config.defaultFlowId ? [config.defaultFlowId] : []]] as const) {
      for (const id of ids) {
        const { data, error } = await getSupabaseAdmin().from(table).select('id').eq('org_id', orgId).eq('id', id).maybeSingle()
        if (error) databaseError(error)
        if (!data) throw new ConfigError(404, 'REFERENCE_NOT_FOUND', 'Related resource was not found')
      }
    }
    if(config.handoffPolicy?.defaultMemberId){const {data,error}=await getSupabaseAdmin().from('team_members').select('id').eq('org_id',orgId).eq('id',config.handoffPolicy.defaultMemberId).eq('active',true).maybeSingle();if(error)databaseError(error);if(!data)throw new ConfigError(404,'REFERENCE_NOT_FOUND','Related member was not found')}
  }
  async validate(orgId: string, id: string) {
    const agent = await this.agent(orgId, id)
    const draft = await this.draft(orgId, id)
    const config = agentConfigSchema.parse(draft.config)
    await this.references(orgId, config)
    const published = agent.published_version_id ? await this.version(orgId, id, agent.published_version_id) : null
    return { revision: draft.revision, publishedVersionId: agent.published_version_id, valid: true, diff: configurationDiff(published?.config ?? null, config), warnings: config.defaultFlowId ? ['Flow configuration is retained for compatibility; the flow engine is unchanged in this phase.'] : [] }
  }
  async mutate(orgId: string, actorId: string, id: string, action: string, payload: Record<string, unknown>) {
    const { data, error } = await getSupabaseAdmin().rpc('mutate_agent_config', { p_org: orgId, p_actor: actorId, p_agent: id, p_action: action, p_payload: payload })
    if (error) databaseError(error)
    return data as { draft: AgentDraft | null; version: AgentVersion | null; publishedVersionId: string | null }
  }
  async create(orgId: string, actorId: string, config: AgentConfig) {
    await this.references(orgId, config)
    const id = randomUUID()
    await this.mutate(orgId, actorId, id, 'create', { config })
    return this.agent(orgId, id)
  }
}
export const agentVersionService = new AgentVersionService()
