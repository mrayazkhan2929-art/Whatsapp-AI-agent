import type { NextFunction, Response } from 'express'
import { sendApiError } from '../http.js'
import type { AuthenticatedRequest } from '../types.js'

export function requireOrgScope(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  // Discard any pre-existing scope; only canonical membership resolution can supply it.
  request.orgId = undefined
  if (!request.auth?.orgId) {
    sendApiError(response, 403, 'ORG_SCOPE_REQUIRED', 'Organization scope is required')
    return
  }

  request.orgId = request.auth.orgId
  const mutation=!['GET','HEAD','OPTIONS'].includes(request.method)
  const adminArea=/^\/api\/v1\/(?:settings|agents|flows|devices)(?:\/|$)/.test(request.originalUrl)
  if(mutation&&(request.auth.role==='viewer'||(adminArea&&!['owner','admin'].includes(request.auth.role)))){
    sendApiError(response,403,'FORBIDDEN','Your role cannot change this resource')
    return
  }
  next()
}
