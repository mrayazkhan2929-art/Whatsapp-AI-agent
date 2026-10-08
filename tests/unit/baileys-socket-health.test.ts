import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { WebSocketClient } from '@whiskeysockets/baileys/lib/Socket/Client/websocket.js'
import { BaileysManager } from '../../backend/src/whatsapp/BaileysManager'
import { selfHealEngine } from '../../backend/src/modules/session/selfHealEngine'
const storage = vi.hoisted(() => ({ rpc: vi.fn((name: string) => {
  const result = Promise.resolve({ data: name === 'device_runtime_lease' ? { generation: 1 } : null, error: null })
  return Object.assign(result, { abortSignal: () => result })
}) }))
vi.mock('../../backend/src/config/supabase', () => ({ getSupabaseAdmin: () => storage }))
vi.mock('../../backend/src/whatsapp/DBAuthState', () => ({ DBAuthState: class {}, useDBAuthState: async () => ({ state: { creds: {}, keys: { get: async () => ({}), set: async () => undefined } }, saveCreds: async () => undefined }) }))
vi.mock('../../backend/src/modules/session/selfHealEngine', () => ({ selfHealEngine: { registerDevice: vi.fn(), unregisterDevice: vi.fn(), startHealthMonitor: vi.fn(), onConnect: vi.fn() } }))
vi.mock('../../backend/src/modules/ai/aiService', () => ({ sanitize: (text: string) => text }))
it.each([0, 1, 2, 3])('reads the real Baileys wrapper when its inner WebSocket state is %s', async (state) => {
  // Use the installed adapter getters, rather than inventing readyState on ws.
  const ws = new WebSocketClient(new URL('wss://web.whatsapp.com/ws/chat'), {} as never)
  Object.assign(ws, { socket: { readyState: state } })
  expect('readyState' in ws).toBe(false)
  const ev = new EventEmitter()
  const manager = new BaileysManager({ deviceId: 'local-health-device', orgId: 'local-health-org' }, {
    latestVersion: async () => ({ version: [2, 3000, 0], isLatest: true }) as never,
    makeSocket: (() => {
      queueMicrotask(() => ev.emit('connection.update', { connection: 'connecting' }))
      return { ev, ws, end: vi.fn() }
    }) as never,
  })
  try {
    await manager.connect()
    const registration = vi.mocked(selfHealEngine.registerDevice).mock.calls.at(-1)![2]
    expect(registration.getSocketState()).toBe(state)
  } finally { await manager.pause() }
})
