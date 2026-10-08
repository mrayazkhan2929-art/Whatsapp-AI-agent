import type { NextFunction, Response } from 'express'
import type { User } from '@supabase/supabase-js'
import { getSupabaseAdmin, isSupabaseConfigured } from '../../config/supabase.js'
import { sendApiError } from '../http.js'
import type { AuthenticatedRequest } from '../types.js'

export interface IdentityRequest extends AuthenticatedRequest { identity?: User }

// Identity-only authorization is restricted to explicit new-workspace provisioning.
export async function requireConfirmedIdentity(request: IdentityRequest, response: Response, next: NextFunction) {
  if (!isSupabaseConfigured()) { sendApiError(response,503,'AUTH_UNAVAILABLE','Authentication service unavailable'); return }
  const token = /^Bearer\s+(\S+)$/i.exec(request.header('authorization') ?? '')?.[1]
  if (!token) { sendApiError(response,401,'UNAUTHORIZED','Authentication required'); return }
  try {
    const result = await getSupabaseAdmin().auth.getUser(token)
    if (result.error || !result.data.user) {
      const status = result.error?.status
      const unavailable = status === 0 || (status ?? 0) >= 500 || result.error?.name === 'AuthRetryableFetchError'
      sendApiError(response,unavailable ? 503 : 401,unavailable ? 'AUTH_UNAVAILABLE' : 'INVALID_SESSION','Unable to validate identity'); return
    }
    if (!result.data.user.email || !result.data.user.email_confirmed_at) { sendApiError(response,403,'EMAIL_CONFIRMATION_REQUIRED','Confirm your email before creating a workspace'); return }
    request.identity = result.data.user
    next()
  } catch { sendApiError(response,503,'AUTH_UNAVAILABLE','Authentication service unavailable') }
}
