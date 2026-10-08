import type { NextFunction, Response } from 'express'
import { getSupabaseAdmin, isSupabaseConfigured } from '../../config/supabase.js'
import { sendApiError } from '../http.js'
import type { AuthenticatedRequest } from '../types.js'

const roles = new Set(['owner', 'admin', 'operator', 'member', 'viewer'])

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> {
  if (!isSupabaseConfigured()) {
    sendApiError(response, 503, 'SUPABASE_NOT_CONFIGURED', 'Supabase is not configured')
    return
  }
  const authorization = request.header('authorization')
  const cookie = request.headers.cookie?.split(';').map(p => p.trim()).reverse()
    .find(p => p.startsWith('sb-access-token='))?.slice('sb-access-token='.length)
  const token = authorization !== undefined ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : cookie
  if (!token) {
    sendApiError(response, 401, 'UNAUTHORIZED', 'Authentication required')
    return
  }
  try {
    const supabase = getSupabaseAdmin()
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      const unavailable = userError && (userError.status === 0 || (userError.status ?? 0) >= 500 || userError.name === 'AuthRetryableFetchError')
      sendApiError(response, unavailable ? 503 : 401, unavailable ? 'AUTH_UNAVAILABLE' : 'INVALID_SESSION', unavailable ? 'Authentication service unavailable' : 'Invalid session token')
      return
    }
    const columns = 'id, org_id, role, email, name, active'
    const { data: direct, error: directError } = await supabase.from('users').select(columns).eq('id', user.id).maybeSingle()
    if (directError) throw directError
    let member = direct
    // Count inactive email matches too; disabling one cannot choose another tenant.
    if (!member && user.email && user.email_confirmed_at) {
      const { data: matches, error } = await supabase.from('users').select(columns).eq('email', user.email).limit(2)
      if (error) throw error
      if (matches && matches.length > 1) {
        sendApiError(response, 403, 'AMBIGUOUS_MEMBERSHIP', 'Application membership is ambiguous')
        return
      }
      member = matches?.[0] ?? null
    }
    if (!member) {
      sendApiError(response, 403, 'ONBOARDING_REQUIRED', 'Application membership is required')
      return
    }
    if (member.active !== true || !roles.has(member.role) || !member.org_id) {
      sendApiError(response, 403, 'MEMBERSHIP_INACTIVE', 'Active application membership is required')
      return
    }
    const { data: organization, error: orgError } = await supabase.from('organizations').select('id').eq('id', member.org_id).maybeSingle()
    if (orgError) throw orgError
    if (!organization) {
      sendApiError(response, 403, 'ONBOARDING_REQUIRED', 'Application organization is required')
      return
    }
    request.auth = { userId: member.id, orgId: organization.id, role: member.role, email: member.email, name: member.name ?? '' }
    next()
  } catch {
    sendApiError(response, 500, 'AUTH_LOOKUP_FAILED', 'Failed to resolve application membership')
  }
}

