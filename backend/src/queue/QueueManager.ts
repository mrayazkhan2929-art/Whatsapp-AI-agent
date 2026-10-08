import { Queue, Worker, type Processor } from 'bullmq'
import IORedis from 'ioredis'
import { env } from '../config/env.js'

export class QueueManager {
  private readonly queues = new Map<string, Queue>()
  private readonly workers = new Set<Worker>()
  private readonly workerClients = new Map<Worker, Set<IORedis>>()
  private closing = false
  private readonly connection =
    env.REDIS_HOST && env.REDIS_PORT
      ? new IORedis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 3000,
          enableReadyCheck: false,
          reconnectOnError: () => true,
          retryStrategy: (attempt) => Math.min(attempt * 1_000, 15_000),
        })
      : null

  constructor() {
    this.connection?.on('error', () => console.error(JSON.stringify({tag:'QUEUE_CONNECTION_UNAVAILABLE'})))
  }

  createQueue<T>(name: string): Queue<T> | null {
    if (!this.connection || this.closing) {
      return null
    }

    const existing = this.queues.get(name)
    if (existing) return existing as Queue<T>
    const queue = new Queue<T>(name, { connection: this.connection, defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 } })
    queue.on('error', () => console.error(JSON.stringify({tag:'QUEUE_UNAVAILABLE',queue:name})))
    this.queues.set(name, queue)
    return queue
  }

  createWorker<T>(name: string, processor: Processor<T>): Worker<T> | null {
    if (!this.connection || this.closing) {
      return null
    }

    const connection=new IORedis({host:env.REDIS_HOST,port:env.REDIS_PORT,password:env.REDIS_PASSWORD,maxRetriesPerRequest:null,connectTimeout:3000})
    const clients=new Set([connection]),duplicate=connection.duplicate.bind(connection)
    connection.duplicate=(...args)=>{const client=duplicate(...args);clients.add(client);return client}
    connection.on('error',()=>console.error(JSON.stringify({tag:'WORKER_CONNECTION_UNAVAILABLE',queue:name})))
    const worker = new Worker<T>(name, processor, { connection, concurrency: 1 })
    worker.on('error', () => console.error(JSON.stringify({tag:'WORKER_UNAVAILABLE',queue:name})))
    worker.on('failed', () => console.error(JSON.stringify({tag:'WORKER_JOB_FAILED',queue:name})))
    this.workers.add(worker)
    this.workerClients.set(worker,clients)
    worker.on('closed', () => {
      this.workers.delete(worker)
      for(const client of clients)client.disconnect()
      this.workerClients.delete(worker)
    })
    return worker
  }

  async shutdown(): Promise<void> {
    if (this.closing) return
    this.closing = true
    const workers=[...this.workers]
    let timer:NodeJS.Timeout|undefined
    await Promise.race([
      Promise.all(workers.map(worker=>worker.close(this.connection?.status!=='ready').catch(()=>undefined))),
      new Promise<void>(resolve=>{timer=setTimeout(resolve,5000)}),
    ]).finally(()=>clearTimeout(timer))
    // Closing a waiting worker can stall during Redis loss. Disconnect its sockets
    // after the grace period; durable DB claims recover indexing safely.
    // Own the raw clients so initial connection failure cannot make disconnect
    // wait forever for BullMQ's unresolved ready promise.
    for(const clients of this.workerClients.values())for(const client of clients)client.disconnect()
    this.connection?.disconnect()
    await Promise.all([...this.queues.values()].map(queue => queue.close().catch(()=>undefined)))
    this.queues.clear()
  }
}
