import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type ConnectionState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import { DeviceLeaseService } from './DeviceLeaseService.js'
import { getSupabaseAdmin } from '../config/supabase.js'
import { sanitize } from '../modules/ai/aiService.js'
import { selfHealEngine } from '../modules/session/selfHealEngine.js'
import { DBAuthState, useDBAuthState as createDbAuthState } from './DBAuthState.js'

export interface BaileysManagerConfig {
  deviceId: string
  orgId: string
  onLeaseLost?: () => void
  onQR?: (qr: string) => void
  onConnectionUpdate?: (state: ConnectionState) => void
  onMessages?: (messages: WAMessage[], type: string) => void
  onTransportEvent?: (event: {
    kind: 'connected' | 'reconnecting' | 'replaced' | 'disconnected'
    detail?: string
  }) => void
}

export interface SendTextResult {
  messageId: string | null
}

export interface BaileysRuntimeDependencies {
  makeSocket?: typeof makeWASocket
  latestVersion?: typeof fetchLatestBaileysVersion
  leaseTTLSeconds?: number
}

export class BaileysManager {
  private readonly supabase = getSupabaseAdmin()
  private socket: WASocket | null = null
  private status: 'idle' | 'connecting' | 'qr' | 'open' | 'closed' = 'idle'
  private intentionalClose = false
  private connecting?: Promise<WASocket>
  readonly lease: DeviceLeaseService

  constructor(private readonly config: BaileysManagerConfig, private readonly runtime: BaileysRuntimeDependencies = {}) {
    this.lease = new DeviceLeaseService(config.deviceId, config.orgId, () => {
      const socket = this.socket
      this.socket = null; this.status = 'closed'
      selfHealEngine.unregisterDevice(config.deviceId)
      socket?.end(new Error('DEVICE_LEASE_LOST'))
      this.config.onLeaseLost?.()
    }, this.supabase, runtime.leaseTTLSeconds ?? 30)
  }

  async connect(forceFresh = false): Promise<WASocket> {
    if (this.connecting) return this.connecting
    this.connecting = this.openSocket(forceFresh).finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private async openSocket(forceFresh: boolean): Promise<WASocket> {
    if (!this.lease.fence.generation) await this.lease.acquire()
    else await this.lease.assertOwned()
    selfHealEngine.registerDevice(this.config.deviceId, this.config.orgId, {
      reconnect: async () => { await this.connect() },
      // Baileys wraps ws; readyState belongs to its protected inner socket.
      getSocketState: () => {
        const ws = this.socket?.ws
        if (!ws) return undefined
        return ws.isOpen ? 1 : ws.isConnecting ? 0 : ws.isClosing ? 2 : 3
      },
      persistState: async values => { await this.persistDeviceState(values.status as 'connected' | 'connecting' | 'disconnected') },
    })
    selfHealEngine.startHealthMonitor()
    if (this.socket && this.status !== 'closed') {
      return this.socket
    }

    if (this.socket && this.status === 'closed') {
      this.socket = null
    }

    const authStore = new DBAuthState(this.config.deviceId, this.config.orgId, this.lease)
    if (forceFresh) await authStore.clear()
    const { state, saveCreds } = await createDbAuthState(authStore)
    const { version } = await (this.runtime.latestVersion ?? fetchLatestBaileysVersion)()

    this.status = 'connecting'
    await this.persistDeviceState('connecting')

    let createdSocket:WASocket|undefined
    // Add timeout wrapper for socket creation
    const createSocketWithTimeout = (): Promise<WASocket> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Socket creation timed out after 30 seconds'))
        }, 30000) // 30 second timeout

        try {
          const socket = (this.runtime.makeSocket ?? makeWASocket)({
            version,
            printQRInTerminal: false,
            auth: {
              creds: state.creds,
              keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
            },
            browser: ['IERE Bot', 'Chrome', '1.0.0'],
            // Add connection timeout options
            connectTimeoutMs: 20000,
            keepAliveIntervalMs: 10000,
            qrTimeout: 60000,
          })
          createdSocket=socket

          // Clear timeout on successful connection
          const clearTimeoutOnConnect = (update: any) => {
            if (update.connection === 'open' || update.connection === 'connecting') {
              clearTimeout(timeout)
              socket.ev.off('connection.update', clearTimeoutOnConnect)
            }
          }

          socket.ev.on('connection.update', clearTimeoutOnConnect)
          socket.ev.on('connection.update', (update) => {
            void (async () => { await this.lease.assertOwned(); if (socket === this.socket) await this.handleConnectionUpdate(update, authStore) })().catch(() => this.lease.invalidate())
          })
          socket.ev.on('creds.update', () => {
            if (socket === this.socket) void saveCreds().catch(() => this.lease.invalidate())
          })
          socket.ev.on('messages.upsert', ({ messages, type }) => {
            if (type !== 'notify' || socket !== this.socket || !this.lease.isCurrent()) {
              return
            }

            const inboundMessages = messages.filter((message) => !message?.key.fromMe && Boolean(message.message))
            if (inboundMessages.length > 0) {
              void this.lease.assertOwned().then(() => { if (socket === this.socket && this.lease.isCurrent()) this.config.onMessages?.(inboundMessages, type) }).catch(() => undefined)
            }
          })

          resolve(socket)
        } catch (error) {
          clearTimeout(timeout)
          reject(error)
        }
      })
    }

    try {
      const socket = await createSocketWithTimeout()
      this.socket = socket
      // Assign before awaiting the renewal so an early open event is retained.
      // Loss during that renewal still ends this assigned socket immediately.
      await this.lease.assertOwned()
      return socket
    } catch (error) {
      createdSocket?.end(new Error('DEVICE_LEASE_LOST'))
      console.error(`Failed to create WhatsApp socket for device ${this.config.deviceId}:`, error)
      this.status = 'closed'
      await this.persistDeviceState('disconnected').catch(() => undefined)
      await this.lease.release()
      throw error
    }
  }

  async reconnect(): Promise<WASocket> {
    this.intentionalClose = true
    if (this.socket) {
      this.socket.end(new Error('Manual reconnect'))
      this.socket = null
    }

    this.status = 'closed'
    return this.connect()
  }

  async disconnect(): Promise<void> {
    if (this.lease.isCurrent()) await this.persistDeviceState('disconnected').catch(() => undefined)
    await this.pause()
  }

  async pause(): Promise<void> {
    this.intentionalClose = true
    const socket = this.socket
    this.socket = null; this.status = 'closed'
    socket?.end(new Error('Runtime stopped'))
    selfHealEngine.unregisterDevice(this.config.deviceId)
    await this.lease.release()
  }

  async sendText(jid: string, text: string, messageId?: string): Promise<SendTextResult> {
    if (!this.socket || !this.isConnected()) {
      throw new Error('WhatsApp socket is not connected')
    }

    // BUG 4 FIX: Sanitize all outbound messages to remove placeholder artifacts
    const safeText = sanitize(text)
    const socket = this.socket
    await this.lease.assertOwned()
    if (!this.lease.isCurrent() || socket !== this.socket || !this.isConnected()) throw new Error('DEVICE_LEASE_LOST')
    let timeout: NodeJS.Timeout | undefined
    const result = await Promise.race([
      socket.sendMessage(jid, { text: safeText }, messageId ? { messageId } : undefined),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { this.lease.invalidate(); reject(new Error('SEND_OUTCOME_UNKNOWN')) }, 15000)
        timeout.unref()
      }),
    ]).finally(() => clearTimeout(timeout))

    return {
      messageId: result?.key?.id ?? null,
    }
  }

  getConnectionState(): string {
    return this.status
  }

  isConnected(): boolean {
    return this.status === 'open' && this.lease.isCurrent()
  }

  async waitForConnection(timeoutMs = 15_000): Promise<void> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      if (this.isConnected()) {
        return
      }

      if (this.status === 'closed') {
        throw new Error('WhatsApp session is closed')
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    throw new Error(`WhatsApp session did not become ready within ${timeoutMs}ms`)
  }

  private async handleConnectionUpdate(
    update: Partial<ConnectionState>,
    authStore: DBAuthState,
  ): Promise<void> {
    this.config.onConnectionUpdate?.(update as ConnectionState)

    if (update.qr) {
      this.status = 'qr'
      this.config.onQR?.(update.qr)
      try {
        await this.persistDeviceState('connecting', update.qr)
      } catch (error) {
        console.error(`Failed to persist QR state for device ${this.config.deviceId}:`, error)
      }
    }

    if (update.connection === 'open') {
      this.status = 'open'
      this.intentionalClose = false
      this.config.onTransportEvent?.({ kind: 'connected' })
      selfHealEngine.onConnect(this.config.deviceId, this.config.orgId)
      try {
        await this.persistDeviceState('connected', undefined, this.extractConnectedPhone())
      } catch (error) {
        console.error(`Failed to persist connected state for device ${this.config.deviceId}:`, error)
      }
      return
    }

    if (update.connection === 'close') {
      this.socket = null
      this.status = 'closed'

      if (this.intentionalClose) {
        this.intentionalClose = false
        try {
          await this.persistDeviceState('disconnected')
        } catch (error) {
          console.error(`Failed to persist intentional disconnect for device ${this.config.deviceId}:`, error)
        }
        return
      }

      const statusCode = this.getDisconnectStatusCode(update.lastDisconnect?.error)
      const hasCorruptKeyError = this.containsCorruptKeyError(update.lastDisconnect?.error)
      const wasReplaced = this.containsReplacementConflict(update.lastDisconnect?.error)
      const reasonName =
        typeof statusCode === 'number'
          ? (DisconnectReason[statusCode] ?? `code:${statusCode}`)
          : 'unknown'
      console.warn(`WhatsApp disconnected for ${this.config.deviceId}. reason=${reasonName}`)

      if (wasReplaced) {
        this.config.onTransportEvent?.({
          kind: 'replaced',
          detail: 'Another WhatsApp Web/Desktop session replaced this bot session',
        })
        try {
          await this.persistDeviceState('disconnected')
        } catch (error) {
          console.error(`Failed to persist replaced-session state for device ${this.config.deviceId}:`, error)
        }
        console.error(
          `[WHATSAPP] Device ${this.config.deviceId} session was replaced by another WhatsApp session. Re-pair this bot after closing other Web/Desktop sessions.`,
        )
        return
      }

      const requiresFreshAuth =
        hasCorruptKeyError ||
        statusCode === DisconnectReason.loggedOut ||
        statusCode === DisconnectReason.badSession ||
        statusCode === DisconnectReason.multideviceMismatch ||
        statusCode === DisconnectReason.forbidden

      if (requiresFreshAuth) {
        this.config.onTransportEvent?.({
          kind: 'disconnected',
          detail: reasonName,
        })
        try {
          await authStore.clear()
        } catch (error) {
          console.error(`Failed to clear auth state for device ${this.config.deviceId}:`, error)
        }

        try {
          await this.persistDeviceState('connecting')
        } catch (error) {
          console.error(`Failed to persist reconnecting state for device ${this.config.deviceId}:`, error)
        }

        selfHealEngine.onDisconnect(this.config.deviceId, this.config.orgId, reasonName)
        return
      }

      const shouldReconnect =
        (!hasCorruptKeyError && statusCode == null) ||
        statusCode === DisconnectReason.restartRequired ||
        statusCode === DisconnectReason.connectionClosed ||
        statusCode === DisconnectReason.connectionLost ||
        statusCode === DisconnectReason.timedOut ||
        statusCode === DisconnectReason.unavailableService ||
        (update.lastDisconnect?.error as any)?.message?.includes('Timed Out') ||
        (update.lastDisconnect?.error as any)?.message?.includes('timeout')

      if (shouldReconnect) {
        this.config.onTransportEvent?.({
          kind: 'reconnecting',
          detail: reasonName,
        })
        console.log(`Scheduling reconnection for device ${this.config.deviceId} due to ${reasonName}`)
        try {
          await this.persistDeviceState('connecting')
        } catch (error) {
          console.error(`Failed to persist reconnecting state for device ${this.config.deviceId}:`, error)
        }
        selfHealEngine.onDisconnect(this.config.deviceId, this.config.orgId, reasonName)
        return
      }

      try {
        await this.persistDeviceState('disconnected')
      } catch (error) {
        console.error(`Failed to persist disconnected state for device ${this.config.deviceId}:`, error)
      }
      this.config.onTransportEvent?.({
        kind: 'disconnected',
        detail: reasonName,
      })
      selfHealEngine.onDisconnect(this.config.deviceId, this.config.orgId, reasonName)
    }
  }

  private getDisconnectStatusCode(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
      return null
    }

    const typedError = error as {
      output?: { statusCode?: number }
      statusCode?: number
      data?: { statusCode?: number }
    }

    return (
      typedError.output?.statusCode ??
      typedError.statusCode ??
      typedError.data?.statusCode ??
      null
    )
  }

  private containsCorruptKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false
    }

    const candidate = error as {
      message?: string
      data?: { message?: string }
      cause?: { message?: string }
    }

    const message = `${candidate.message ?? ''} ${candidate.data?.message ?? ''} ${candidate.cause?.message ?? ''}`
    return message.toLowerCase().includes('invalid private key type')
  }

  private containsReplacementConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false
    }

    const candidate = error as {
      message?: string
      data?: { message?: string }
      output?: { payload?: { message?: string } }
      cause?: { message?: string }
    }

    const message = [
      candidate.message,
      candidate.data?.message,
      candidate.output?.payload?.message,
      candidate.cause?.message,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return message.includes('conflict') || message.includes('replaced')
  }

  private extractConnectedPhone(): string | null {
    const rawUserId = this.socket?.user?.id
    if (!rawUserId) {
      return null
    }

    const [phone] = rawUserId.split(':')
    return phone ? `+${phone.replace(/\D/g, '')}` : null
  }

  private async persistDeviceState(
    status: 'connected' | 'disconnected' | 'connecting',
    qrCode?: string,
    phone?: string | null,
  ): Promise<void> {
    const fence = this.lease.fence
    const { error } = await this.supabase.rpc('fenced_device_state', {
      p_org: this.config.orgId, p_device: this.config.deviceId,
      p_owner: fence.ownerId, p_generation: fence.generation,
      p_status: status, p_qr: qrCode ?? null, p_phone: phone ?? null,
    })
    if (error) { if (error.code === 'PT409') this.lease.invalidate(); throw new Error('DEVICE_STATE_UNAVAILABLE') }
  }
}
