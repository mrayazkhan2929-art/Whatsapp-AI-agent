import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../config/supabase.js'

export class DeviceLeaseError extends Error {
  constructor(readonly code: 'DEVICE_LEASE_HELD' | 'DEVICE_LEASE_LOST' | 'DEVICE_LEASE_UNAVAILABLE') { super(code) }
}
export interface DeviceFence { ownerId: string; generation: number }
/** One handle per socket incarnation. A lost handle never reacquires ownership. */
export class DeviceLeaseService {
  readonly ownerId = randomUUID()
  private generation = 0
  private deadline = 0
  private lost = false
  private timer?: NodeJS.Timeout
  private expiry?: NodeJS.Timeout
  private renewing?: Promise<void>
  constructor(readonly deviceId: string, readonly orgId: string,
    private readonly onLost: () => void,
    private readonly db: SupabaseClient = getSupabaseAdmin(),
    private readonly ttlSeconds = 30,
  ) {}
  get fence(): DeviceFence { return { ownerId: this.ownerId, generation: this.generation } }
  isCurrent() { return !this.lost && this.generation > 0 && performance.now() < this.deadline }
  async acquire() {
    if (this.lost) throw new DeviceLeaseError('DEVICE_LEASE_LOST')
    if (this.generation) { await this.assertOwned(); return }
    const started = performance.now()
    const { data, error } = await this.db.rpc('device_runtime_lease', this.params('acquire')).abortSignal(AbortSignal.timeout(3000))
    if (error) throw new DeviceLeaseError('DEVICE_LEASE_UNAVAILABLE')
    if (!data) throw new DeviceLeaseError('DEVICE_LEASE_HELD')
    this.generation = Number(data.generation)
    if (!Number.isSafeInteger(this.generation) || this.generation < 1) { this.invalidate(); throw new DeviceLeaseError('DEVICE_LEASE_LOST') }
    this.extend(started)
    this.timer = setInterval(() => void this.assertOwned().catch(() => undefined), Math.max(100, this.ttlSeconds * 1000 / 5))
    this.timer.unref()
  }
  async assertOwned() {
    if (!this.isCurrent()) { this.invalidate(); throw new DeviceLeaseError('DEVICE_LEASE_LOST') }
    if (!this.renewing) {
      this.renewing = (async () => {
        const started = performance.now()
        try {
          const { data, error } = await this.db.rpc('device_runtime_lease', this.params('renew')).abortSignal(AbortSignal.timeout(3000))
          if (error || !data || Number(data.generation) !== this.generation || this.lost) throw new DeviceLeaseError('DEVICE_LEASE_LOST')
          this.extend(started)
        } catch { this.invalidate(); throw new DeviceLeaseError('DEVICE_LEASE_LOST') }
      })().finally(() => { this.renewing = undefined })
    }
    await this.renewing
    if (!this.isCurrent()) { this.invalidate(); throw new DeviceLeaseError('DEVICE_LEASE_LOST') }
  }
  async release() {
    const params = this.params('release')
    const owned = this.isCurrent()
    this.invalidate()
    if (owned) await this.db.rpc('device_runtime_lease', params).abortSignal(AbortSignal.timeout(3000))
  }
  invalidate() {
    if (this.lost) return
    this.lost = true
    clearInterval(this.timer); clearTimeout(this.expiry)
    this.onLost()
  }
  private params(action: string) { return { p_org: this.orgId, p_device: this.deviceId, p_owner: this.ownerId, p_generation: this.generation || null, p_action: action, p_ttl: this.ttlSeconds } }
  private extend(started: number) {
    // Start-of-request monotonic deadline is conservative under network delay and wall-clock skew.
    this.deadline = started + this.ttlSeconds * 1000 - Math.min(5000, this.ttlSeconds * 200)
    clearTimeout(this.expiry)
    const remaining = this.deadline - performance.now()
    if (remaining <= 0) { this.invalidate(); throw new DeviceLeaseError('DEVICE_LEASE_LOST') }
    this.expiry = setTimeout(() => this.invalidate(), remaining)
    this.expiry.unref()
  }
}
