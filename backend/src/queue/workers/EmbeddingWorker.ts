import type { Job } from 'bullmq'
import { z } from 'zod'
import { KnowledgeIngestion } from '../../rag/KnowledgeIngestion.js'

export interface EmbeddingWorkerJob {
  orgId: string
  versionId: string
}

const schema = z.object({orgId:z.string().uuid(),versionId:z.string().uuid()}).strict()
export async function processEmbeddingJob(job: Pick<Job<EmbeddingWorkerJob>,'data'>, ingestion:KnowledgeIngestion=new KnowledgeIngestion()): Promise<void> {
  const data = schema.parse(job.data)
  await ingestion.processVersion(data.orgId,data.versionId)
}
