import type { NextFunction, Response } from 'express'
import { sendApiError } from '../http.js'
import type { AuthenticatedRequest } from '../types.js'

const WINDOW_MS = 60_000
const MAX_REQUESTS = 120
const counters = new Map<string, { count: number; resetAt: number }>()

export function apiRateLimit(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): void {
  const key = `${request.ip ?? 'unknown'}:${request.baseUrl || request.path}`
  const now = Date.now()
  if(counters.size>=10_000){
    for(const [key,value] of counters){if(value.resetAt<=now)counters.delete(key)}
    if(counters.size>=10_000&&!counters.has(key)){sendApiError(response,429,'RATE_LIMITED','Too many requests. Please try again shortly.');return}
  }
  const entry = counters.get(key)

  if (!entry || entry.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + WINDOW_MS })
    next()
    return
  }

  if (entry.count >= MAX_REQUESTS) {
    response.setHeader('Retry-After',String(Math.max(1,Math.ceil((entry.resetAt-now)/1000))))
    sendApiError(response, 429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.')
    return
  }

  entry.count += 1
  next()
}
