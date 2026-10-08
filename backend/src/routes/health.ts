import { Router } from 'express'
import { runHealthCheck } from '../lib/healthCheck.js'
import type { AuthenticatedRequest } from '../api/types.js'

const router = Router()

router.get('/', async (request: AuthenticatedRequest, response) => {
  try {
    const health = await runHealthCheck(request.orgId!)
    const httpStatus = health.status === 'critical' ? 503 : 200
    response.status(httpStatus).json(health)
  } catch (error) {
    response.status(503).json({
      status: 'critical',
      error: error instanceof Error ? error.message : 'Health check failed',
      timestamp: new Date().toISOString(),
    })
  }
})

export default router
