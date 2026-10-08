import type { Worker, Processor } from 'bullmq'
import { QueueManager } from './QueueManager.js'
import { processEmbeddingJob, type EmbeddingWorkerJob } from './workers/EmbeddingWorker.js'
import type { MessageWorkerJob } from './workers/MessageWorker.js'

export class WorkerRuntime {
  private readonly queues = new QueueManager()
  private started = false
  private closing = false
  start(processor:Processor<EmbeddingWorkerJob>=job=>processEmbeddingJob(job)) {
    if (this.started || this.closing) return
    this.started = true
    this.queues.createWorker<EmbeddingWorkerJob>('document-indexing',processor)
  }
  async embedding(orgId: string, versionId: string) {
    if (this.closing) return false
    const queue = this.queues.createQueue<EmbeddingWorkerJob>('document-indexing')
    if (!queue) return false
    try {
      // A completed notification can outlive the DB parsing lease it tried to claim.
      // Recovery may recreate that notification; DB ownership still admits one parser.
      return await this.bounded(async () => {
        const existing = await queue.getJob(versionId)
        if (existing && ['completed','failed'].includes(await existing.getState())) await existing.remove()
        await queue.add('index',{orgId,versionId},{jobId:versionId})
        return true
      })
    } catch { return false }
  }
  async outbound(data: MessageWorkerJob) {
    const queue = this.queues.createQueue<MessageWorkerJob>('device-send-'+data.deviceId)
    if (!queue) return
    try { await this.bounded(() => queue.add('send',data,{jobId:data.requestId})) } catch { /* Durable owner poll also admits queued requests. */ }
  }
  ownerWorker(deviceId: string, processor: Processor<MessageWorkerJob>): Worker<MessageWorkerJob> | null {
    return this.queues.createWorker<MessageWorkerJob>('device-send-'+deviceId,processor)
  }
  async shutdown() { this.closing=true; await this.queues.shutdown() }
  private async bounded<T>(run:()=>Promise<T>):Promise<T> {
    let timer:NodeJS.Timeout|undefined
    try { return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('QUEUE_UNAVAILABLE')),2000)})]) }
    finally { clearTimeout(timer) }
  }
}
export const workerRuntime = new WorkerRuntime()
