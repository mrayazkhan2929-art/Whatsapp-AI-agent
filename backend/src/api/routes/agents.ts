import { Router, type Response } from 'express'
import { z } from 'zod'
import { agentConfigSchema, agentVersionService, ConfigError, databaseError, defaultAgentConfig } from '../../modules/config/AgentVersionService.js'
import { runtimeConfigResolver, compileAgentInstructions } from '../../modules/config/RuntimeConfigResolver.js'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { sendApiError } from '../http.js'
import type { AuthenticatedRequest } from '../types.js'
import {mandatoryStudioChecks,runStudioPlayground,redactStudioValue} from '../../modules/config/StudioPlayground.js'
import {propertySearchCriteriaSchema} from '../../properties/PropertySearchCriteria.js'
import { dialogueSchema } from '../../modules/ai/ReplyContext.js'

const router = Router()
const revisionSchema = z.object({ expectedRevision: z.number().int().positive(), expectedPublishedVersionId: z.string().uuid().nullable() })
function control(handler: (req: AuthenticatedRequest, res: Response) => Promise<void>, write = false) {
  return async (request: AuthenticatedRequest, response: Response) => {
    if (!request.orgId || !request.auth) { sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required'); return }
    try {
      if (request.params.id) z.string().uuid().parse(request.params.id)
      if (write && !['owner', 'admin'].includes(request.auth.role)) throw new ConfigError(403, 'FORBIDDEN', 'Only owners and administrators can change agent configuration')
      await handler(request, response)
    } catch (error) {
      if (error instanceof z.ZodError) { sendApiError(response, 400, 'VALIDATION_FAILED', error.issues[0]?.message ?? 'Invalid configuration'); return }
      if (error instanceof ConfigError) { sendApiError(response, error.status, error.code, error.message); return }
      sendApiError(response, 500, 'AGENT_CONTROL_FAILED', 'Agent configuration operation failed')
    }
  }
}
router.get('/runtime/current', control(async (req, res) => {
  const deviceId = req.query.deviceId ? z.string().uuid().parse(req.query.deviceId) : undefined
  const runtime = await runtimeConfigResolver.resolve(req.orgId!, deviceId)
  res.json({ success: true, data: { ...runtime, effectiveInstructions: compileAgentInstructions(runtime) } })
}))
router.post('/', control(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(120), config: agentConfigSchema.optional() }).parse(req.body)
  const config = body.config ?? defaultAgentConfig(body.name)
  res.status(201).json({ success: true, data: await agentVersionService.create(req.orgId!, req.auth!.userId, config) })
}, true))
router.patch('/:id', control(async (req, res) => {
  await agentVersionService.agent(req.orgId!, String(req.params.id))
  const payload = z.object({ name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional() }).strict().parse(req.body)
  await agentVersionService.mutate(req.orgId!, req.auth!.userId, String(req.params.id), 'metadata', payload)
  res.json({ success: true, data: await agentVersionService.agent(req.orgId!, String(req.params.id)) })
}, true))
router.get('/:id/draft', control(async (req, res) => { res.json({ success: true, data: await agentVersionService.draft(req.orgId!, String(req.params.id)) }) }))
router.patch('/:id/draft', control(async (req, res) => {
  await agentVersionService.agent(req.orgId!, String(req.params.id))
  const body = revisionSchema.extend({ config: agentConfigSchema }).parse(req.body)
  await agentVersionService.references(req.orgId!, body.config)
  res.json({ success: true, data: await agentVersionService.mutate(req.orgId!, req.auth!.userId, String(req.params.id), 'save', body) })
}, true))
router.post('/:id/validate', control(async (req, res) => { res.json({ success: true, data: await agentVersionService.validate(req.orgId!, String(req.params.id)) }) }))
router.post('/:id/test', control(async (req, res) => {
  const body = revisionSchema.parse(req.body)
  const validation = await agentVersionService.validate(req.orgId!, String(req.params.id))
  const draft = await agentVersionService.draft(req.orgId!, String(req.params.id))
  const checks=await mandatoryStudioChecks(req.orgId!,String(req.params.id),draft.revision)
  const result = await agentVersionService.mutate(req.orgId!, req.auth!.userId, String(req.params.id), 'test', body)
  res.json({ success: true, data: { ...result,...checks } })
}, true))
router.post('/:id/playground',control(async(req,res)=>{
 await agentVersionService.agent(req.orgId!,String(req.params.id))
 const body=z.object({expectedRevision:z.number().int().positive(),message:z.string().trim().min(1).max(2000),state:propertySearchCriteriaSchema.default({excludeRefs:[]}),mode:z.enum(['preview','model']).default('preview'),dialogue:dialogueSchema.optional(),history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(4000)})).max(12).optional(),language:z.enum(['en','ar']).optional()}).parse(req.body)
 const result=await runStudioPlayground(req.orgId!,String(req.params.id),body.expectedRevision,body.message,body.state,body.mode,body.dialogue,body.history,body.language)
 const {data,error}=await getSupabaseAdmin().from('agent_playground_runs').insert({org_id:req.orgId,agent_id:req.params.id,actor_id:req.auth!.userId,draft_revision:result.draftRevision,config_sha256:result.configSHA256,summary:redactStudioValue(result)}).select('id').single()
 if(error)databaseError(error)
 res.json({success:true,data:{traceId:data!.id,...result}})
},true))
router.get('/:id/traces',control(async(req,res)=>{
 await agentVersionService.agent(req.orgId!,String(req.params.id))
 const {data,error}=await getSupabaseAdmin().from('agent_playground_runs').select('id,draft_revision,summary,created_at').eq('org_id',req.orgId!).eq('agent_id',req.params.id).order('created_at',{ascending:false}).limit(100)
 if(error)databaseError(error);res.json({success:true,data})
}))
router.delete('/:id/channels/:deviceId',control(async(req,res)=>{
 await agentVersionService.agent(req.orgId!,String(req.params.id))
 const deviceId=z.string().uuid().parse(req.params.deviceId)
 const {error}=await getSupabaseAdmin().rpc('unlink_agent_channel',{p_org:req.orgId,p_actor:req.auth!.userId,p_agent:req.params.id,p_device:deviceId})
 if(error)databaseError(error);res.json({success:true,data:{deviceId}})
},true))
router.post('/:id/publish', control(async (req, res) => {
  const body = revisionSchema.parse(req.body)
  await agentVersionService.validate(req.orgId!, String(req.params.id))
  res.json({ success: true, data: await agentVersionService.mutate(req.orgId!, req.auth!.userId, String(req.params.id), 'publish', body) })
}, true))
router.get('/:id/versions', control(async (req, res) => {
  await agentVersionService.agent(req.orgId!, String(req.params.id))
  const { data, error } = await getSupabaseAdmin().from('agent_versions').select('*').eq('org_id', req.orgId!).eq('agent_id', req.params.id).order('version_number', { ascending: false })
  if (error) databaseError(error)
  res.json({ success: true, data })
}))
router.get('/:id/versions/:versionId', control(async (req, res) => {
  const versionId = z.string().uuid().parse(req.params.versionId)
  res.json({ success: true, data: await agentVersionService.version(req.orgId!, String(req.params.id), versionId) })
}))
router.post('/:id/versions/:versionId/rollback', control(async (req, res) => {
  const versionId = z.string().uuid().parse(req.params.versionId)
  const body = revisionSchema.parse(req.body)
  const version = await agentVersionService.version(req.orgId!, String(req.params.id), versionId)
  const config = agentConfigSchema.parse(version.config)
  await agentVersionService.references(req.orgId!, config)
  res.json({ success: true, data: await agentVersionService.mutate(req.orgId!, req.auth!.userId, String(req.params.id), 'rollback', { ...body, versionId }) })
}, true))
router.get('/:id/channels', control(async (req, res) => {
  await agentVersionService.agent(req.orgId!, String(req.params.id))
  const { data, error } = await getSupabaseAdmin().from('agent_channel_links').select('device_id').eq('org_id', req.orgId!).eq('agent_id', req.params.id)
  if (error) databaseError(error)
  res.json({ success: true, data })
}))
router.post('/:id/channels', control(async (req, res) => {
  const body = z.object({ deviceId: z.string().uuid() }).parse(req.body)
  res.json({ success: true, data: await agentVersionService.mutate(req.orgId!, req.auth!.userId, String(req.params.id), 'link', body) })
}, true))
router.get('/:id/activity', control(async (req, res) => {
  await agentVersionService.agent(req.orgId!, String(req.params.id))
  const { data, error } = await getSupabaseAdmin().from('agent_config_events').select('*').eq('org_id', req.orgId!).eq('agent_id', req.params.id).order('created_at', { ascending: false }).limit(100)
  if (error) databaseError(error)
  res.json({ success: true, data })
}))

router.get('/', async (request: AuthenticatedRequest, response) => {
  const orgId = request.orgId
  if (!orgId) {
    sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required')
    return
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) {
    sendApiError(response, 500, 'AGENTS_FETCH_FAILED', error.message)
    return
  }

  response.json({ success: true, data })
})

router.get('/:id', async (request: AuthenticatedRequest, response) => {
  const orgId = request.orgId
  if (!orgId) {
    sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required')
    return
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', request.params.id)
    .maybeSingle()

  if (error) {
    sendApiError(response, 500, 'AGENT_FETCH_FAILED', error.message)
    return
  }

  if (!data) {
    sendApiError(response, 404, 'AGENT_NOT_FOUND', 'Agent was not found')
    return
  }

  response.json({ success: true, data })
})

export default router
