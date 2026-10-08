import {expect,it,vi} from 'vitest'
import {KnowledgeIngestion} from '../../backend/src/rag/KnowledgeIngestion'
const runtime=vi.hoisted(()=>({embedding:vi.fn(async()=>true)}))
vi.mock('../../backend/src/queue/WorkerRuntime',()=>({workerRuntime:runtime}))
function ingestion(){
 const version={documentId:'document',versionId:'version',versionNumber:1,status:'queued'}
 const service=new KnowledgeIngestion({rpc:vi.fn(async()=>({data:version,error:null}))} as any)
 vi.spyOn(service,'requireKB').mockResolvedValue(undefined)
 vi.spyOn(service,'processVersion').mockResolvedValue(true)
 vi.spyOn(service,'list').mockResolvedValue([{id:'document',versions:[{id:'version',status:'ready',chunk_count:1}]}] as any)
 return{service,version}
}
it('asynchronous admission publishes the persisted version without indexing inline',async()=>{
 const {service,version}=ingestion();expect(await service.enqueue('org','kb','guide.txt',Buffer.from('Verified guide'))).toEqual(version)
 expect(runtime.embedding).toHaveBeenCalledWith('org','version');expect(service.processVersion).not.toHaveBeenCalled()
})
it('legacy synchronous ingestion does not race a queued worker for its completion result',async()=>{
 const {service}=ingestion();expect(await service.ingestText('org','kb','guide.txt','Verified guide')).toMatchObject({status:'completed',chunksCount:1})
 expect(service.processVersion).toHaveBeenCalledWith('org','version');expect(runtime.embedding).not.toHaveBeenCalled()
})
