import { beforeEach, expect, it, vi } from 'vitest'
import type { WAMessage } from '@whiskeysockets/baileys'
import { MessageRouter } from '../../backend/src/whatsapp/MessageRouter'
import { transportDb } from '../support/transport-db'

const dependencies = vi.hoisted(() => ({ db: null as any, reply: vi.fn(), send: vi.fn() }))
vi.mock('../../backend/src/config/supabase', () => ({ isSupabaseConfigured: () => true, getSupabaseAdmin: () => dependencies.db }))
vi.mock('../../backend/src/modules/ai/aiService', () => ({ generateReply: dependencies.reply }))
// Stub the transport seam before its dynamic gateway import, including concurrent calls.
const newRouter = () => {
  const router = new MessageRouter()
  vi.spyOn(router as any, 'sendTextViaGateway').mockImplementation(dependencies.send)
  return router
}

const event: WAMessage = { key: { id: 'fixture-wa-123', remoteJid: '971500000001@s.whatsapp.net', fromMe: false }, message: { conversation: 'Hi' } }
beforeEach(() => {
  dependencies.db = transportDb()
  dependencies.reply.mockResolvedValue({ reply: 'Fixture reply', lane: 'CHAT', lang: 'en', handoff: false })
  dependencies.send.mockImplementation(async input => ({ deviceId: input.deviceId, messageId: input.messageId }))
})

it('real MessageRouter persists text, invokes AI and sends through its gateway abstraction', async () => {
  await newRouter().routeMessage('device-a', 'tenant-a', event)
  expect(dependencies.reply).toHaveBeenCalledTimes(1)
  expect(dependencies.send).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'tenant-a', deviceId: 'device-a', text: 'Fixture reply' }))
  expect(dependencies.db.tables.messages.map((row: any) => row.direction)).toEqual(['inbound', 'outbound'])
})
it('image inbound is persisted without generating a text reply', async () => {
  await newRouter().routeMessage('device-a', 'tenant-a', { ...event, message: { imageMessage: { caption: 'Fixture image' } } })
  expect(dependencies.db.tables.messages).toHaveLength(1)
  expect(dependencies.reply).not.toHaveBeenCalled()
  expect(dependencies.send).not.toHaveBeenCalled()
})
it('history and conversation writes stay scoped when malformed foreign children exist', async () => {
  dependencies.db = transportDb({
    contacts:[{ id:'ca',org_id:'tenant-a',phone:'971500000001' }],
    conversations:[{ id:'conv-a',org_id:'tenant-a',contact_id:'ca',status:'active' }],
    messages:[{ id:'mb',org_id:'tenant-b',conversation_id:'conv-a',direction:'inbound',content:'Private B' }],
  })
  await newRouter().routeMessage('device-a','tenant-a',event)
  expect(JSON.stringify(dependencies.reply.mock.calls)).not.toContain('Private B')
  expect(dependencies.db.tables.messages.find((row:any) => row.id === 'mb').content).toBe('Private B')
  for (const query of dependencies.db.queries.filter((query:any) => query.table === 'conversations')) {
    if (query.filters.length) expect(query.filters).toContainEqual(['eq','org_id','tenant-a'])
  }
})

it('P5 inbound persistence carries original WhatsApp ID and tenant/device context', async () => {
  await newRouter().routeMessage('device-a', 'tenant-a', event)
  expect(dependencies.db.tables.messages.find((r: any) => r.direction === 'inbound')).toMatchObject({wa_message_id:'fixture-wa-123',device_id:'device-a',org_id:'tenant-a',processing_status:'completed'})
})
for (const mode of ['twice','10 concurrently','after new router instance','two replicas'] as const) {
  it('P5 duplicate '+mode+' executes and sends once', async () => {
    const router=newRouter()
    if(mode==='10 concurrently'||mode==='two replicas')await Promise.all(Array.from({length:10},(_,i)=>(mode==='two replicas'&&i%2?newRouter():router).routeMessage('device-a','tenant-a',event)))
    else{await router.routeMessage('device-a','tenant-a',event);await (mode==='after new router instance'?newRouter():router).routeMessage('device-a','tenant-a',event)}
    expect(dependencies.reply).toHaveBeenCalledTimes(1);expect(dependencies.send).toHaveBeenCalledTimes(1)
    expect(dependencies.db.tables.messages).toHaveLength(2)
  })
}
it('same text with distinct IDs executes twice',async()=>{
  const router=newRouter();await router.routeMessage('device-a','tenant-a',event)
  await router.routeMessage('device-a','tenant-a',{...event,key:{...event.key,id:'another-id'}})
  expect(dependencies.reply).toHaveBeenCalledTimes(2);expect(dependencies.send).toHaveBeenCalledTimes(2)
})
it('missing ID and own echoes never execute or persist',async()=>{
  await newRouter().routeMessage('device-a','tenant-a',{...event,key:{...event.key,id:undefined}})
  await newRouter().routeMessage('device-a','tenant-a',{...event,key:{...event.key,fromMe:true}})
  expect(dependencies.db.tables.messages).toHaveLength(0);expect(dependencies.reply).not.toHaveBeenCalled()
})
it('transport failure saves one uncertain response and does not send a second fallback',async()=>{
  dependencies.send.mockRejectedValue(Error('Socket timeout'))
  await newRouter().routeMessage('device-a','tenant-a',event);await newRouter().routeMessage('device-a','tenant-a',event)
  expect(dependencies.reply).toHaveBeenCalledTimes(1);expect(dependencies.send).toHaveBeenCalledTimes(1)
  expect(dependencies.db.tables.messages).toHaveLength(2)
  expect(dependencies.db.tables.messages[1]).toMatchObject({processing_status:'needs_review',failure_code:'SEND_OUTCOME_UNKNOWN'})
})
it('persistence failures fail closed before business execution',async()=>{
  dependencies.db.rpc=vi.fn(async()=>({data:null,error:{code:'LOCAL_DB_FAILURE'}}))
  await newRouter().routeMessage('device-a','tenant-a',event)
  expect(dependencies.reply).not.toHaveBeenCalled();expect(dependencies.send).not.toHaveBeenCalled()
})

it('P6 handoff flag persists a real lifecycle event', async () => {
 dependencies.reply.mockResolvedValue({reply:'Fixture handoff',lane:'AGENT',lang:'en',handoff:true})
 await newRouter().routeMessage('device-a','tenant-a',event)
 expect(dependencies.reply).toHaveBeenCalledTimes(1)
 expect(dependencies.db.tables.handoff_events).toHaveLength(1)
 expect(dependencies.db.tables.conversations[0]).toMatchObject({handoff_state:'HANDOFF_REQUESTED',handled_by:'human'})
})
it('P6 explicit human requests bypass AI and persist a handoff',async()=>{
 await newRouter().routeMessage('device-a','tenant-a',{...event,message:{conversation:'Connect me with an agent'}})
 expect(dependencies.reply).not.toHaveBeenCalled()
 expect(dependencies.db.tables.handoff_events).toHaveLength(1)
})
it('P6 human-active conversations persist inbound without executing or sending AI',async()=>{
 dependencies.db=transportDb({contacts:[{id:'ca',org_id:'tenant-a',phone:'971500000001'}],conversations:[{id:'conv-a',org_id:'tenant-a',contact_id:'ca',status:'active',handoff_state:'HUMAN_ACTIVE',handled_by:'human'}]})
 await newRouter().routeMessage('device-a','tenant-a',event)
 expect(dependencies.reply).not.toHaveBeenCalled();expect(dependencies.send).not.toHaveBeenCalled()
 expect(dependencies.db.tables.messages).toHaveLength(1)
})
