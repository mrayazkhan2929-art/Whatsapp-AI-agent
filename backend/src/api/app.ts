import express from 'express'
import { degradedServices, env, envIssues } from '../config/env.js'
import { BUILD_ID, PIPELINE_VERSION, buildRuntimeFingerprint } from '../config/runtimeFingerprint.js'
import agentsRouter from './routes/agents.js'
import analyticsRouter from './routes/analytics.js'
import authRouter from './routes/auth.js'
import chatRouter from './routes/chat.js'
import bookingsRouter from './routes/bookings.js'
import contactsRouter from './routes/contacts.js'
import conversationsRouter from './routes/conversations.js'
import devicesRouter from './routes/devices.js'
import flowsRouter from './routes/flows.js'
import knowledgeRouter from './routes/knowledge.js'
import knowledgeDocumentsRouter from './routes/knowledgeDocuments.js'
import messagesRouter from './routes/messages.js'
import nudgesRouter from './routes/nudges.js'
import propertiesRouter from './routes/properties.js'
import settingsRouter from './routes/settings.js'
import handoffsRouter from './routes/handoffs.js'
import { requireAuth } from './middleware/auth.js'
import { requireOrgScope } from './middleware/orgScope.js'
import { apiRateLimit } from './middleware/rateLimit.js'
import { getSupabaseAdmin } from '../config/supabase.js'
import type { AuthenticatedRequest } from './types.js'
import healthRouter from '../routes/health.js'
import observabilityRouter from './routes/observability.js'
import { auditMutation } from './middleware/audit.js'
import { whatsAppGateway } from '../whatsapp/WhatsAppGateway.js'


export function createApiApp(port: number) {
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))

app.get('/', (_request, response) => {
  response.status(200).json({
    ok: true,
    service: 'iere-whatsapp-backend',
    buildId: BUILD_ID,
    pipelineVersion: PIPELINE_VERSION,
  })
})

app.get('/healthz', (_request, response) => {
  response.status(200).json({
    ok: true,
    service: 'iere-whatsapp-backend',
    buildId: BUILD_ID,
    pipelineVersion: PIPELINE_VERSION,
    uptime: Math.round(process.uptime()),
  })
})

app.use('/api/v1/health', requireAuth, requireOrgScope, healthRouter)

app.get('/api/v1/setup/status', requireAuth, requireOrgScope, async (request: AuthenticatedRequest, response) => {
  const { data: devices, error } = await getSupabaseAdmin().from('devices').select('id').eq('org_id', request.orgId!)
  if (error) { response.status(500).json({ error: 'Device status lookup failed' }); return }
  const ids = (devices ?? []).map(device => device.id as string)
  const runtimeFingerprint = buildRuntimeFingerprint(port, whatsAppGateway.getConnectedDeviceIds().filter(id => ids.includes(id)))
  response.json({
    success: true,
    data: {
      runtimeFingerprint,
      degradedServices,
      envIssues,
      timezone: env.TZ,
      ready: envIssues.length === 0,
      whatsappRuntime: whatsAppGateway.getRuntimeSnapshotSummary(ids),
    },
  })
})

app.use('/api/v1/auth', apiRateLimit, authRouter)
app.use('/api/v1/observability', apiRateLimit, requireAuth, requireOrgScope, observabilityRouter)
app.use('/api/v1/chat', apiRateLimit, requireAuth, requireOrgScope, auditMutation, chatRouter)
app.use('/api/v1/devices', apiRateLimit, requireAuth, requireOrgScope, auditMutation, devicesRouter)
app.use('/api/v1/contacts', apiRateLimit, requireAuth, requireOrgScope, auditMutation, contactsRouter)
app.use('/api/v1/conversations', apiRateLimit, requireAuth, requireOrgScope, auditMutation, conversationsRouter)
app.use('/api/v1/messages', apiRateLimit, requireAuth, requireOrgScope, auditMutation, messagesRouter)
app.use('/api/v1/properties', apiRateLimit, requireAuth, requireOrgScope, auditMutation, propertiesRouter)
app.use('/api/v1/agents', apiRateLimit, requireAuth, requireOrgScope, auditMutation, agentsRouter)
app.use('/api/v1/knowledge', apiRateLimit, requireAuth, requireOrgScope, auditMutation, knowledgeDocumentsRouter, knowledgeRouter)
app.use('/api/v1/flows', apiRateLimit, requireAuth, requireOrgScope, auditMutation, flowsRouter)
app.use('/api/v1/bookings', apiRateLimit, requireAuth, requireOrgScope, auditMutation, bookingsRouter)
app.use('/api/v1/analytics', apiRateLimit, requireAuth, requireOrgScope, auditMutation, analyticsRouter)
app.use('/api/v1/nudges', apiRateLimit, requireAuth, requireOrgScope, auditMutation, nudgesRouter)
app.use('/api/v1/settings', apiRateLimit, requireAuth, requireOrgScope, auditMutation, settingsRouter)
app.use('/api/v1/handoffs', apiRateLimit, requireAuth, requireOrgScope, auditMutation, handoffsRouter)

app.use((error:unknown,_request:express.Request,response:express.Response,_next:express.NextFunction)=>{
  const status=typeof error==='object'&&error!==null&&'status' in error&&error.status===413?413:error instanceof SyntaxError&&'body' in error?400:500
  response.status(status).json({success:false,code:status===413?'PAYLOAD_TOO_LARGE':status===400?'INVALID_REQUEST':'INTERNAL_ERROR',error:status===413?'Request is too large':status===400?'Invalid request':'Request failed'})
})
  return app
}
