import { Router } from 'express'
import { z } from 'zod'
import { getSupabaseAdmin } from '../../config/supabase.js'
import { sendApiError } from '../http.js'
import type { AuthenticatedRequest } from '../types.js'
import { checkTenantReferences } from '../tenant.js'
import { companyProfileSchema, organizationProfileService } from '../../modules/company/OrganizationProfileService.js'

const router = Router()

router.get('/company-profile', async (request: AuthenticatedRequest, response) => {
  if (!request.orgId) { sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required'); return }
  try {
    response.json({ success: true, data: await organizationProfileService.get(request.orgId) })
  } catch { sendApiError(response, 500, 'COMPANY_PROFILE_FETCH_FAILED', 'Company profile could not be loaded') }
})

router.patch('/company-profile', async (request: AuthenticatedRequest, response) => {
  if (!request.orgId) { sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required'); return }
  if (!['owner', 'admin'].includes(request.auth?.role ?? '')) {
    sendApiError(response, 403, 'FORBIDDEN', 'Only owners and administrators can edit the company profile'); return
  }
  const parsed = companyProfileSchema.safeParse(request.body)
  if (!parsed.success) { sendApiError(response, 400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Invalid company profile'); return }
  try {
    response.json({ success: true, data: await organizationProfileService.save(request.orgId, parsed.data) })
  } catch { sendApiError(response, 500, 'COMPANY_PROFILE_SAVE_FAILED', 'Company profile could not be saved') }
})

const updateSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  plan: z.string().min(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

router.get('/', async (request: AuthenticatedRequest, response) => {
  const orgId = request.orgId
  if (!orgId) {
    sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required')
    return
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .maybeSingle()

  if (error) {
    sendApiError(response, 500, 'SETTINGS_FETCH_FAILED', error.message)
    return
  }

  response.json({ success: true, data })
})

router.patch('/', async (request: AuthenticatedRequest, response) => {
  const orgId = request.orgId
  if (!orgId) {
    sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required')
    return
  }

  const parsed = updateSettingsSchema.safeParse(request.body)
  if (!parsed.success) {
    sendApiError(response, 400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Invalid settings payload')
    return
  }

  const supabase = getSupabaseAdmin()
  const team = parsed.data.settings?.team
  const defaultAgent = team && typeof team === 'object' && 'defaultHandoffAgentId' in team ? team.defaultHandoffAgentId : null
  const denial = await checkTenantReferences(supabase, orgId, [['team_members', defaultAgent]])
  if (denial) { response.status(denial.status).json(denial); return }
  const { data, error } = await supabase
    .from('organizations')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orgId)
    .select('*')
    .single()

  if (error) {
    sendApiError(response, 500, 'SETTINGS_UPDATE_FAILED', error.message)
    return
  }

  response.json({ success: true, data })
})

export default router
