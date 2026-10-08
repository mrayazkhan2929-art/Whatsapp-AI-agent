// Local transport boundary only: all ownership, encryption, queue and DB code is real.
import {EventEmitter} from 'node:events'
import {readFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import {WhatsAppGateway,whatsAppGateway} from '../../backend/src/whatsapp/WhatsAppGateway.js'
import {MessageRouter} from '../../backend/src/whatsapp/MessageRouter.js'
import {workerRuntime} from '../../backend/src/queue/WorkerRuntime.js'
import {processMessageJob} from '../../backend/src/queue/workers/MessageWorker.js'
import {createApiApp} from '../../backend/src/api/app.js'
import {DBAuthState} from '../../backend/src/whatsapp/DBAuthState.js'
import {DeviceLeaseService} from '../../backend/src/whatsapp/DeviceLeaseService.js'
import pg from 'pg'
import {KnowledgeIngestion} from '../../backend/src/rag/KnowledgeIngestion.js'
import {processEmbeddingJob} from '../../backend/src/queue/workers/EmbeddingWorker.js'

async function main(){
const stack=JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!,'utf8'))
const db=createClient(stack.url,stack.serviceKey,{auth:{persistSession:false}})
const sql=new pg.Client({connectionString:stack.dbUrl});await sql.connect()
const nativeFetch=globalThis.fetch
globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('EXTERNAL_TEST_REQUEST_BLOCKED');return nativeFetch(input,init)}
let mode='normal',physicalSends=0
const ingestion=new KnowledgeIngestion(db,async texts=>{
 await sql.query('insert into phase10_test_embedding_calls(replica,chunk_count) values($1,$2)',[process.env.REPLICA_NAME,texts.length])
 return texts.map(()=>[1,...Array(1535).fill(0)])
})
const gateway=new WhatsAppGateway({leaseTTLSeconds:2,latestVersion:async()=>({version:[2,3000,0],isLatest:true}) as any,makeSocket:((options:any)=>{
 const ev=new EventEmitter(),socket={ev,ws:{readyState:1},user:{id:'971500001111:1@s.whatsapp.net'},end:()=>{socket.ws.readyState=3},sendMessage:async(jid:string,body:{text:string},sendOptions:{messageId?:string})=>{
  const target=process.env.REPLICA_DEVICE!,org=process.env.REPLICA_ORG!,session=(gateway as any).sessions.get(target),fence=session?.manager.lease.fence
  if(!fence)throw new Error('TEST_SOCKET_WITHOUT_OWNER')
  const check=await db.rpc('device_runtime_lease',{p_org:org,p_device:target,p_owner:fence.ownerId,p_generation:fence.generation,p_action:'check'})
  if(check.error)throw new Error('TEST_PHYSICAL_FENCE_REJECTED')
  await sql.query('insert into phase10_test_physical_sends(org_id,device_id,wa_id,owner_id,generation,replica,jid,content) values($1,$2,$3,$4,$5,$6,$7,$8)',[org,target,sendOptions?.messageId??'UNSTABLE',fence.ownerId,fence.generation,process.env.REPLICA_NAME,jid,body.text])
  physicalSends++;process.send?.({kind:'effect',waId:sendOptions?.messageId})
  if(mode==='crash-after-send')process.exit(78)
  if(mode==='unknown')throw new Error('TEST_ACKNOWLEDGEMENT_LOST')
  return{key:{id:sendOptions?.messageId}}
 }}
 // Emit only after the manager has assigned its socket and persisted connecting.
 const timer=setInterval(()=>{if(socket.ws.readyState!==1){clearInterval(timer);return}ev.emit('connection.update',{connection:'open'});clearInterval(timer)},250)
 timer.unref()
 void options
 return socket
 }) as any})
Object.assign(gateway,{messageRouter:new MessageRouter({send:input=>gateway.sendText(input),generateReply:async()=>({reply:'Verified saved response',lane:'CHAT',lang:'en',handoff:false,replyMode:'prebuilt',intent:{}}) as any})})
// API handlers exercise their actual Auth, membership and tenant checks on this replica.
for(const method of ['connectDevice','disconnectDevice','getRuntimeSnapshot','getTransportHealth','getRuntimeSnapshotSummary','sendText'] as const){(whatsAppGateway as any)[method]=(gateway[method] as any).bind(gateway)}
const server=createApiApp(0).listen(0,'127.0.0.1');await new Promise<void>(done=>server.on('listening',done))
process.send?.({kind:'ready',url:'http://127.0.0.1:'+(server.address() as any).port})
process.on('message',(message:any)=>void(async()=>{
 const {command,id}=message;let result:unknown
 const dev=process.env.REPLICA_DEVICE!,org=process.env.REPLICA_ORG!
 if(command==='connect')result=await gateway.connectDevice(dev,org)
 else if(command==='bootstrap'){await gateway.bootstrap();result=true}
 else if(command==='snapshot'){const session=(gateway as any).sessions.get(dev);result={snapshot:gateway.getRuntimeSnapshot(dev),fence:session?.manager.lease.fence,physicalSends}}
 else if(command==='send')result=await gateway.sendText({orgId:org,deviceId:dev,jid:'971500001111@s.whatsapp.net',text:'Verified relay response',...message.input})
 else if(command==='mode'){mode=message.mode;result=true}
 else if(command==='freeze'){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,message.ms);const session=(gateway as any).sessions.get(dev);await session.manager.sendText('971500001111@s.whatsapp.net','Stale forbidden send',message.waId);result=true}
 else if(command==='write-auth'){const session=(gateway as any).sessions.get(dev);const store=new DBAuthState(dev,org,session.manager.lease);await store.writeData('test','secret',{token:'LOCAL_ONLY_SECRET',bytes:Buffer.from([1,2,3])});result=await store.readData('test','secret')}
 else if(command==='index'){workerRuntime.start(job=>processEmbeddingJob(job,ingestion));result=await workerRuntime.embedding(org,message.versionId)}
 else if(command==='index-notification'){workerRuntime.start(job=>processEmbeddingJob(job,ingestion));result=await workerRuntime.embedding(org,message.versionId)}
 else if(command==='recover-index'){await ingestion.recover(org);result=true}
 else if(command==='process-stale'){const lease=new DeviceLeaseService(dev,org,()=>{},db,2);Object.assign(lease,{ownerId:message.ownerId,generation:message.generation,deadline:performance.now()+2000});await processMessageJob({data:{orgId:org,deviceId:dev,requestId:message.requestId}},{db,lease,send:input=>gateway.sendText(input)});result=true}
 else if(command==='shutdown'){await gateway.shutdown();await workerRuntime.shutdown();await sql.end();await new Promise<void>(done=>server.close(()=>done()));process.send?.({kind:'done',id,result:true});process.exit(0)}
 else throw new Error('UNKNOWN_TEST_COMMAND')
 process.send?.({kind:'done',id,result})
})().catch((error:Error)=>process.send?.({kind:'done',id:message.id,error:error.message})))
}
void main().catch(error=>{console.error(error);process.exit(1)})
