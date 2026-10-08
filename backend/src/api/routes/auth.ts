import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireOrgScope } from '../middleware/orgScope.js'
import type { AuthenticatedRequest } from '../types.js'
import { requireConfirmedIdentity, type IdentityRequest } from '../middleware/identity.js'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { sendApiError } from '../http.js'
import { z } from 'zod'

const router = Router()

router.post('/onboard', requireConfirmedIdentity, async (request: IdentityRequest, response) => {
  const parsed = z.object({ companyName:z.string().trim().min(2).max(100),name:z.string().trim().min(1).max(100) }).safeParse(request.body)
  if (!parsed.success) { sendApiError(response,400,'VALIDATION_FAILED','Enter your company name and your name'); return }
  try {
    const result = await getSupabaseAdmin().rpc('onboard_organization',{ p_user:request.identity!.id,p_name:parsed.data.companyName,p_member_name:parsed.data.name })
    if (result.error) {
      const status = ({ PT400:400,PT403:403,PT409:409 } as Record<string,number>)[result.error.code] ?? 500
      sendApiError(response,status,status===409 ? 'MEMBERSHIP_EXISTS' : status===403 ? 'EMAIL_CONFIRMATION_REQUIRED' : 'ONBOARDING_FAILED',status>=500 ? 'Workspace creation failed' : result.error.message); return
    }
    response.status(201).json({success:true,data:{orgId:result.data}})
  } catch { sendApiError(response,500,'ONBOARDING_FAILED','Workspace creation failed') }
})

router.get('/onboarding',requireAuth,requireOrgScope,async (request:AuthenticatedRequest,response)=>{
  try {
    const db=getSupabaseAdmin(),org=request.orgId!
    const results=await Promise.all([
      db.from('organization_profiles').select('legal_name').eq('org_id',org).maybeSingle(),
      db.from('agents').select('id,published_version_id').eq('org_id',org),
      db.from('agent_drafts').select('config').eq('org_id',org),
      db.from('knowledge_documents').select('id').eq('org_id',org).eq('enabled',true).is('deleted_at',null).not('current_version_id','is',null).limit(1),
      db.from('properties').select('id').eq('org_id',org).limit(1),
      db.from('team_members').select('id').eq('org_id',org).eq('active',true).limit(1),
      db.from('organizations').select('settings').eq('id',org).single(),
      db.from('devices').select('id,status').eq('org_id',org),
      db.from('agent_playground_runs').select('id').eq('org_id',org).limit(1),
      db.from('messages').select('id').eq('org_id',org).eq('direction','inbound').limit(1),
    ])
    if(results.some(result=>result.error))throw Error('Lookup failed')
    const [company,agents,drafts,knowledge,properties,team,organization,devices,tests,messages]=results
    const complete={company:Boolean(company.data?.legal_name),agent:Boolean(agents.data?.length),instructions:Boolean(drafts.data?.some(d=>typeof d.config?.instructions==='string'&&d.config.instructions.trim())),knowledge:Boolean(knowledge.data?.length),properties:Boolean(properties.data?.length),team:Boolean(team.data?.length),handoff:Boolean(organization.data?.settings?.handoff),device:Boolean(devices.data?.some(d=>d.status==='connected')),test:Boolean(tests.data?.length),publish:Boolean(agents.data?.some(a=>a.published_version_id)),operate:Boolean(messages.data?.length)}
    response.json({success:true,data:{complete,canConfigure:['owner','admin'].includes(request.auth!.role)}})
  }catch{sendApiError(response,500,'ONBOARDING_LOOKUP_FAILED','Unable to load workspace progress')}
})

router.get('/me', requireAuth, requireOrgScope, (request: AuthenticatedRequest, response) => {
  response.json({
    success: true,
    data: request.auth,
  })
})

router.post('/logout', requireAuth, (_request, response) => {
  response.json({
    success: true,
    data: { loggedOut: true },
  })
})

export default router
