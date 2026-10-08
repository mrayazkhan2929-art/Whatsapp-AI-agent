import {readFileSync} from 'node:fs'
import {basename,extname} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import type {SupabaseClient} from '@supabase/supabase-js'
import {getSupabaseAdmin} from '../config/supabase.js'
import {EmbeddingService} from './EmbeddingService.js'
import {ConfigError,databaseError as agentDatabaseError} from '../modules/config/AgentVersionService.js'
function databaseError(error:{code?:string;message:string}):never{if(['PT400','PT404','PT429'].includes(error.code??''))throw new ConfigError(Number(error.code!.slice(2)),'KNOWLEDGE_REQUEST_FAILED',error.message);return agentDatabaseError(error)}

export const MAX_DOCUMENT_BYTES=2*1024*1024
export const documentMediaTypes:Record<string,string>={'.txt':'text/plain','.md':'text/markdown','.json':'application/json','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
export function validateDocument(filename:string,bytes:Buffer):string{
 if(!filename||filename.length>240||/[\x00-\x1f\\/]/.test(filename))throw new ConfigError(400,'INVALID_FILENAME','Use a filename without path separators')
 const type=documentMediaTypes[extname(filename).toLowerCase()]
 if(!type)throw new ConfigError(400,'UNSUPPORTED_DOCUMENT','Use PDF, DOCX, TXT, MD or JSON')
 if(!bytes.length||bytes.length>MAX_DOCUMENT_BYTES)throw new ConfigError(413,'DOCUMENT_SIZE','Documents must be between 1 byte and 2 MB')
 return type
}
export function chunkKnowledge(text:string):string[]{
 const words=text.trim().split(/\s+/).filter(Boolean),chunks:string[]=[]
 for(let i=0;i<words.length;i+=462){const value=words.slice(i,i+512).join(' ');if(value.length>16000)throw new Error('DOCUMENT_TOKEN_TOO_LONG');chunks.push(value)}
 if(!chunks.length)throw new Error('DOCUMENT_EMPTY')
 if(chunks.length>200)throw new Error('DOCUMENT_TOO_COMPLEX')
 return chunks
}
export function validateDocxArchive(bytes:Buffer){
 let end=bytes.length-22;while(end>=Math.max(0,bytes.length-65557)&&bytes.readUInt32LE(end)!==0x06054b50)end--
 if(end<0||bytes.readUInt32LE(end)!==0x06054b50)throw Error('DOCUMENT_PARSE_FAILED')
 const count=bytes.readUInt16LE(end+10);let offset=bytes.readUInt32LE(end+16),expanded=0
 if(count>500)throw Error('DOCUMENT_TOO_COMPLEX')
 for(let i=0;i<count;i++){if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('DOCUMENT_PARSE_FAILED');expanded+=bytes.readUInt32LE(offset+24);if(expanded>8*1024*1024)throw Error('DOCUMENT_TOO_COMPLEX');const length=bytes.readUInt16LE(offset+28),name=bytes.subarray(offset+46,offset+46+length).toString();if(name.includes('..')||name.startsWith('/')||name.includes('\\'))throw Error('DOCUMENT_PARSE_FAILED');offset+=46+length+bytes.readUInt16LE(offset+30)+bytes.readUInt16LE(offset+32)}
}
export async function parseKnowledge(bytes:Buffer,type:string):Promise<string>{
 let text:string
 if(type==='application/pdf'){
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('DOCUMENT_PARSE_FAILED')
  const {PDFParse}=await import('pdf-parse'),parser=new PDFParse({data:new Uint8Array(bytes),isEvalSupported:false})
  try{const info=await parser.getInfo();if(info.total>200)throw Error('DOCUMENT_TOO_COMPLEX');text=(await parser.getText()).text}finally{await parser.destroy()}
 }else if(type===documentMediaTypes['.docx']){
  if(bytes.subarray(0,2).toString()!=='PK')throw new Error('DOCUMENT_PARSE_FAILED')
  validateDocxArchive(bytes)
  const {extractRawText}=await import('mammoth');text=(await extractRawText({buffer:bytes})).value
 }else{
  text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  if(type==='application/json')JSON.parse(text)
 }
 if(!text.trim())throw new Error('DOCUMENT_EMPTY')
 if(text.length>2*1024*1024)throw new Error('DOCUMENT_TOO_COMPLEX')
 return text
}
export class KnowledgeIngestion{
 constructor(private readonly db:SupabaseClient=getSupabaseAdmin(),private readonly embedBatch=(texts:string[])=>EmbeddingService.embedBatch(texts)){}
 async requireKB(org:string,kb:string){const r=await this.db.from('knowledge_bases').select('id').eq('org_id',org).eq('id',kb).maybeSingle();if(r.error)databaseError(r.error);if(!r.data)throw new ConfigError(404,'KNOWLEDGE_NOT_FOUND','Related resource was not found')}
 async document(org:string,kb:string,id:string){await this.requireKB(org,kb);const r=await this.db.from('knowledge_documents').select('*').eq('org_id',org).eq('knowledge_base_id',kb).eq('id',id).is('deleted_at',null).maybeSingle();if(r.error)databaseError(r.error);if(!r.data)throw new ConfigError(404,'DOCUMENT_NOT_FOUND','Document was not found');return r.data}
 async enqueue(org:string,kb:string,filename:string,bytes:Buffer,documentId:string|null=null,actor:string|null=null){
  const version=await this.createVersion(org,kb,filename,bytes,documentId,actor)
  const {workerRuntime}=await import('../queue/WorkerRuntime.js');await workerRuntime.embedding(org,version.versionId)
  return version
 }
 private async createVersion(org:string,kb:string,filename:string,bytes:Buffer,documentId:string|null=null,actor:string|null=null){
  await this.requireKB(org,kb);if(documentId)await this.document(org,kb,documentId)
  const type=validateDocument(filename,bytes)
  const r=await this.db.rpc('begin_knowledge_version',{p_org:org,p_kb:kb,p_document:documentId,p_filename:filename,p_source:bytes.toString('base64'),p_media_type:type,p_sha256:createHash('sha256').update(bytes).digest('hex'),p_actor:actor})
  if(r.error)databaseError(r.error);
  return r.data as {documentId:string;versionId:string;versionNumber:number;status:string}
 }
 async processVersion(org:string,versionId:string){
  const token=randomUUID(),claim=await this.db.rpc('claim_knowledge_version',{p_org:org,p_version:versionId,p_token:token})
  if(claim.error)databaseError(claim.error);if(!claim.data)return false
  const version=claim.data
  try{
   if(version.source_base64===null)throw new Error('DOCUMENT_SOURCE_MISSING')
   const text=await parseKnowledge(Buffer.from(version.source_base64,'base64'),version.media_type),chunks=chunkKnowledge(text)
   const stage=await this.db.from('knowledge_document_versions').update({status:'embedding'}).eq('org_id',org).eq('id',versionId).eq('claim_token',token).eq('status','parsing').select('id')
   if(stage.error)databaseError(stage.error);if(!stage.data?.length)return false
   const embeddings=await this.embedBatch(chunks)
   if(embeddings.length!==chunks.length||embeddings.some(vector=>!EmbeddingService.valid(vector)))throw new Error('INVALID_EMBEDDING_RESPONSE')
   const finish=await this.db.rpc('finish_knowledge_version',{p_org:org,p_version:versionId,p_token:token,p_text:text,p_chunks:chunks.map((content,i)=>({content,embedding:embeddings[i]})),p_model:'text-embedding-3-small',p_failure:null})
   if(finish.error)databaseError(finish.error);return Boolean(finish.data)
  }catch(error){
   const code=error instanceof Error&&/^(DOCUMENT_[A-Z_]+|INVALID_EMBEDDING_RESPONSE|EMBEDDING_UNAVAILABLE)$/.test(error.message)?error.message:'DOCUMENT_INDEX_FAILED'
   const failure=await this.db.rpc('finish_knowledge_version',{p_org:org,p_version:versionId,p_token:token,p_text:null,p_chunks:[],p_model:null,p_failure:code})
   if(failure.error)databaseError(failure.error);return false
  }
 }
 async list(org:string,kb:string){
  await this.requireKB(org,kb)
  const docs=await this.db.from('knowledge_documents').select('*, versions:knowledge_document_versions!knowledge_document_versions_document_id_fkey(id,document_id,version_number,status,media_type,source_filename,source_sha256,chunk_count,embedding_model,failure_code,attempts,created_at,indexed_at)').eq('org_id',org).eq('knowledge_base_id',kb).eq('versions.org_id',org).is('deleted_at',null).order('created_at',{ascending:false}).order('version_number',{referencedTable:'versions',ascending:false}).limit(20,{referencedTable:'versions'}).limit(100)
  if(docs.error)databaseError(docs.error)
  const ids=(docs.data??[]).map(d=>d.current_version_id).filter(Boolean)
  const versions=ids.length?await this.db.from('knowledge_document_versions').select('id,document_id,version_number,status,media_type,source_sha256,chunk_count,embedding_model,failure_code,attempts,created_at,indexed_at').eq('org_id',org).in('id',ids):{data:[],error:null}
  if(versions.error)databaseError(versions.error)
  return (docs.data??[]).map(d=>({...d,currentVersion:(versions.data??[]).find(v=>v.document_id===d.id&&v.id===d.current_version_id)??null}))
 }
 async history(org:string,kb:string,id:string,before?:number){await this.document(org,kb,id);let query=this.db.from('knowledge_document_versions').select('id,document_id,version_number,status,media_type,source_filename,source_sha256,chunk_count,embedding_model,failure_code,attempts,created_at,indexed_at').eq('org_id',org).eq('document_id',id).order('version_number',{ascending:false}).limit(20);if(before)query=query.lt('version_number',before);const r=await query;if(r.error)databaseError(r.error);return{data:r.data??[],nextBefore:r.data?.length===20?r.data[19].version_number:null}}
 async reindex(org:string,kb:string,id:string,actor:string|null=null){
  const d=await this.document(org,kb,id),source=await this.db.from('knowledge_document_versions').select('*').eq('org_id',org).eq('document_id',id).eq('version_number',d.latest_version).single()
  if(source.error)databaseError(source.error)
  let bytes:Buffer,filename=source.data.source_filename
  if(source.data.source_base64!==null)bytes=Buffer.from(source.data.source_base64,'base64')
  else{
   const links=await this.db.from('knowledge_document_chunks').select('chunk_id,chunk_index').eq('org_id',org).eq('document_id',id).eq('version_id',source.data.id).order('chunk_index')
   if(links.error)databaseError(links.error)
   const ids=(links.data??[]).map(l=>l.chunk_id),chunks=ids.length?await this.db.from('knowledge_chunks').select('id,content').eq('org_id',org).eq('knowledge_base_id',kb).in('id',ids):{data:[],error:null}
   if(chunks.error)databaseError(chunks.error)
   bytes=Buffer.from(ids.map(chunkId=>chunks.data?.find(c=>c.id===chunkId)?.content??'').join('\n'));filename='legacy-reindex.txt'
  }
  return this.enqueue(org,kb,filename,bytes,id,actor)
 }
 async setEnabled(org:string,kb:string,id:string,enabled:boolean){await this.document(org,kb,id);const r=await this.db.from('knowledge_documents').update({enabled,updated_at:new Date().toISOString()}).eq('org_id',org).eq('knowledge_base_id',kb).eq('id',id).is('deleted_at',null).select('id').maybeSingle();if(r.error)databaseError(r.error);if(!r.data)throw new ConfigError(404,'DOCUMENT_NOT_FOUND','Document was not found')}
 async deleteDocument(id:string,kb:string,org:string){await this.document(org,kb,id);const r=await this.db.from('knowledge_documents').update({enabled:false,deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('org_id',org).eq('knowledge_base_id',kb).eq('id',id);if(r.error)databaseError(r.error)}
 async recover(org?:string){
  let query=this.db.from('knowledge_document_versions').select('id,org_id,attempts,status,lease_until,knowledge_documents!knowledge_document_versions_document_id_fkey!inner(deleted_at)').is('knowledge_documents.deleted_at',null).in('status',['queued','parsing','embedding']).or('status.eq.queued,lease_until.lt.'+new Date().toISOString()).order('created_at').limit(10)
  if(org)query=query.eq('org_id',org)
  const r=await query;if(r.error)databaseError(r.error)
  for(const v of r.data??[]){if(v.status!=='queued'&&new Date(v.lease_until).getTime()>Date.now())continue
   if(v.attempts>=3){const failed=await this.db.from('knowledge_document_versions').update({status:'failed',failure_code:'DOCUMENT_RETRY_EXHAUSTED'}).eq('org_id',v.org_id).eq('id',v.id).eq('attempts',v.attempts).lt('lease_until',new Date().toISOString());if(failed.error)databaseError(failed.error)}else {const {workerRuntime}=await import('../queue/WorkerRuntime.js');if(!await workerRuntime.embedding(v.org_id,v.id))await this.processVersion(v.org_id,v.id)}
  }
 }
 async ingestText(org:string,kb:string,filename:string,content:string){try{const queued=await this.createVersion(org,kb,filename,Buffer.from(content));await this.processVersion(org,queued.versionId);const d=(await this.list(org,kb)).find(item=>item.id===queued.documentId),v=d?.versions.find((item:{id:string})=>item.id===queued.versionId);return{id:queued.documentId,filename,type:'text',chunksCount:v?.chunk_count??0,status:v?.status==='ready'?'completed' as const:'failed' as const}}catch(error){return{id:'',filename,type:'text',chunksCount:0,status:'failed' as const,error:error instanceof Error?error.message:'Ingestion failed'}}}
 async ingestDocument(filePath:string,kb:string,org:string){return this.ingestBytes(org,kb,basename(filePath),readFileSync(filePath))}
 async ingestBytes(org:string,kb:string,filename:string,bytes:Buffer){const q=await this.createVersion(org,kb,filename,bytes);await this.processVersion(org,q.versionId);return q}
 async reprocessDocument(id:string,kb:string,org:string,path:string){const q=await this.createVersion(org,kb,basename(path),readFileSync(path),id);await this.processVersion(org,q.versionId);return q}
 async getDocumentStats(kb:string,org:string){const docs=await this.list(org,kb);return{totalChunks:docs.reduce((n,d)=>n+(d.currentVersion?.chunk_count??0),0),documents:docs.map(d=>({documentId:d.id,filename:d.filename,chunkCount:d.currentVersion?.chunk_count??0}))}}
}
