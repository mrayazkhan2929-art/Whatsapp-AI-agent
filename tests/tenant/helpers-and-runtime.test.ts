import { beforeEach, expect, it, vi } from 'vitest'
import { fakeSupabase } from '../support/fake-supabase'
import { WhatsAppGateway } from '../../backend/src/whatsapp/WhatsAppGateway'
import { HybridRAG } from '../../backend/src/rag/HybridRAG'
import { KnowledgeIngestion } from '../../backend/src/rag/KnowledgeIngestion'

const dependencies = vi.hoisted(() => ({ db:null as any, embed:vi.fn(), embedBatch:vi.fn() }))
vi.mock('../../backend/src/config/supabase', () => ({ isSupabaseConfigured:() => true, getSupabaseAdmin:() => dependencies.db }))
vi.mock('../../backend/src/whatsapp/MessageRouter', () => ({ MessageRouter:class {} }))
vi.mock('../../backend/src/rag/EmbeddingService', () => ({ EmbeddingService:{ embed:dependencies.embed,embedBatch:dependencies.embedBatch } }))
beforeEach(() => {
  dependencies.db = fakeSupabase({ devices:[{ id:'device',org_id:'a' }], knowledge_bases:[{ id:'kb-b',org_id:'b' }] })
})

it('gateway cache cannot reuse, connect or disconnect another organization session', async () => {
  const gateway = new WhatsAppGateway()
  const manager = { connect:vi.fn(), disconnect:vi.fn(), isConnected:vi.fn(() => true) }
  ;(gateway as any).sessions.set('device',{ deviceId:'device',orgId:'b',manager })
  await expect(gateway.connectDevice('device','a',{ forceFreshSession:true })).rejects.toThrow('Device was not found')
  await expect(gateway.disconnectDevice('device','a')).rejects.toThrow('Device was not found')
  await expect((gateway as any).ensureConnectedSession('device','a')).rejects.toThrow('Device was not found')
  expect(manager.connect).not.toHaveBeenCalled()
  expect(manager.disconnect).not.toHaveBeenCalled()
})

it('runtime health summaries include only authorized device IDs', () => {
  const gateway = new WhatsAppGateway()
  const state = gateway as any
  for (const id of ['a','b']) {
    state.transportHealth.set(id,{ deviceId:id,orgId:id,state:'unhealthy',lastEvent:'send_failed',lastDetail:id+' private error',consecutiveSendFailures:2 })
    state.sessions.set(id,{ deviceId:id,orgId:id,manager:{ isConnected:() => true } })
  }
  const summary = gateway.getRuntimeSnapshotSummary(['a'])
  expect(summary.connectedDeviceIds).toEqual(['a'])
  expect(summary.trackedDevices).toBe(1)
  expect(summary.sendFailures).toBe(2)
  expect(summary.alerts).toEqual(['a: a private error'])
  expect(gateway.getRuntimeSnapshotSummary([]).trackedDevices).toBe(0)
})

it('transport blocks unverified English and Arabic cards instead of promising a sales follow-up',async()=>{
 const gateway=new WhatsAppGateway(),manager={isConnected:()=>true,sendText:vi.fn()}
 for(const label of ['Ref','المرجع'])await expect((gateway as any).sendOwnedText({deviceId:'device',orgId:'a',manager},{orgId:'a',deviceId:'device',messageId:'saved',jid:'fixture@s.whatsapp.net',text:`AED 50,000 · ${label}: FOREIGN-1`})).rejects.toThrow('OUTBOUND_REFERENCE_UNVERIFIED')
 expect(manager.sendText).not.toHaveBeenCalled()
 expect(dependencies.db.queries.every((q:any)=>q.filters.some((f:any[])=>f[0]==='eq'&&f[1]==='org_id'&&f[2]==='a'))).toBe(true)
})

it('knowledge helpers reject foreign KB references before embeddings or writes', async () => {
  const rag = new HybridRAG()
  await expect(rag.addKnowledgeChunk('kb-b','a','fixture',{})).rejects.toThrow('Related resource was not found')
  expect(await rag.search('fixture','kb-b','a')).toBe('')
  const ingestion = await new KnowledgeIngestion().ingestText('a','kb-b','fixture.txt','fixture')
  expect(ingestion.status).toBe('failed')
  expect(dependencies.embed).not.toHaveBeenCalled()
  expect(dependencies.embedBatch).not.toHaveBeenCalled()
  expect(dependencies.db.tables.knowledge_chunks ?? []).toEqual([])
})
