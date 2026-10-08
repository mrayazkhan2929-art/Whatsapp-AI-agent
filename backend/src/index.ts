import type { Server } from 'node:http'
import { env } from './config/env.js'
import { BUILD_ID, buildRuntimeFingerprint } from './config/runtimeFingerprint.js'
import { whatsAppGateway } from './whatsapp/WhatsAppGateway.js'
import { createApiApp } from './api/app.js'
import { getSupabaseAdmin,isSupabaseConfigured } from './config/supabase.js'
import { HandoffCoordinator } from './modules/handoff/HandoffCoordinator.js'
import { KnowledgeIngestion } from './rag/KnowledgeIngestion.js'
import {workerRuntime} from './queue/WorkerRuntime.js'
let recoveringKnowledge=false
async function recoverKnowledge(){if(recoveringKnowledge||!isSupabaseConfigured())return;recoveringKnowledge=true;try{await new KnowledgeIngestion().recover()}catch{console.error('[KNOWLEDGE] Recovery failed; durable state retained')}finally{recoveringKnowledge=false}}
setInterval(()=>void recoverKnowledge(),30000).unref()

let recoveringHandoffs=false
let handoffRecoveryReady=false
async function recoverHandoffs(){
 if(recoveringHandoffs||!handoffRecoveryReady||!isSupabaseConfigured())return
 recoveringHandoffs=true
 try{
  const db=getSupabaseAdmin(),{data,error}=await db.from('conversations').select('org_id').in('handoff_state',['HANDOFF_REQUESTED','ASSIGNED','WAITING_FOR_AGENT'])
  if(error)throw error
  for(const org of new Set((data??[]).map(c=>c.org_id)))await new HandoffCoordinator(db).recover(org)
 }catch{console.error('[HANDOFF] Recovery failed; pending state retained')}finally{recoveringHandoffs=false}
}
setInterval(()=>void recoverHandoffs(),30000).unref()

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('[PROCESS] Unhandled Promise Rejection:', reason)
  console.error('[PROCESS] Promise:', promise)
})

process.on('uncaughtException', (error: Error) => {
  console.error('[PROCESS] Uncaught Exception:', error.message)
  console.error('[PROCESS] Stack:', error.stack)

  if (/ENOMEM|out of memory/i.test(error.message)) {
    console.error('[PROCESS] OOM error — process will restart')
    process.exit(1)
  }
})

setInterval(() => {
  const used = process.memoryUsage()
  const heapMB = Math.round(used.heapUsed / 1024 / 1024)
  if (heapMB > 400) {
    console.warn(`[PROCESS] High memory usage: ${heapMB}MB heap used`)
  }
}, 5 * 60 * 1000)

process.env.TZ = env.TZ

const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0')
if (nodeMajor !== 22) {
  console.warn(
    `Node.js ${process.versions.node} detected. WhatsApp/Baileys stability is validated on Node.js 22 LTS.`,
  )
}

const app = createApiApp(env.PORT)

const port = env.PORT
let server: Server | null = null
let hasBootstrappedGateway = false

function startServer(attempt = 0): void {
  const listener = app.listen(port, env.HOST, async () => {
    server = listener
    if (!hasBootstrappedGateway) {
      hasBootstrappedGateway = true
      await whatsAppGateway.bootstrap().catch(() => undefined)
      workerRuntime.start()
      handoffRecoveryReady=true
      await recoverHandoffs()
      await recoverKnowledge()
    }
    console.info(
      `[PIPELINE] fingerprint=${JSON.stringify(buildRuntimeFingerprint(port, whatsAppGateway.getConnectedDeviceIds()))} buildId=${BUILD_ID} entry=src/index.ts path=Baileys>MessageRouter>modules/ai`,
    )
    console.info(`IERE WhatsApp backend running on port ${port}`)
  })

  listener.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && attempt < 10) {
      const nextAttempt = attempt + 1
      const delayMs = 500 * nextAttempt
      console.warn(
        `Port ${port} is busy. Retrying backend bind in ${delayMs}ms (attempt ${nextAttempt}/10).`,
      )
      setTimeout(() => {
        startServer(nextAttempt)
      }, delayMs)
      return
    }

    console.error('Failed to start backend server:', error)
    process.exit(1)
  })
}

startServer()

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}, shutting down backend`)
  await whatsAppGateway.shutdown().catch(() => undefined)
  await workerRuntime.shutdown().catch(() => undefined)
  if (server) {
    server.close(() => {
      process.exit(0)
    })
    return
  }
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
