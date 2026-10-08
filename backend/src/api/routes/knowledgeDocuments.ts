import {Router,raw} from 'express'
import {z} from 'zod'
import {KnowledgeIngestion,MAX_DOCUMENT_BYTES} from '../../rag/KnowledgeIngestion.js'
import {HybridRAG} from '../../rag/HybridRAG.js'
import {ConfigError,agentVersionService} from '../../modules/config/AgentVersionService.js'
import type {AuthenticatedRequest} from '../types.js'
import {sendApiError} from '../http.js'

const router=Router()
function operation(fn:(request:AuthenticatedRequest,response:import('express').Response)=>Promise<void>,write=false){return async(request:AuthenticatedRequest,response:import('express').Response)=>{try{if(!request.orgId)throw new ConfigError(403,'ORG_SCOPE_REQUIRED','Organization scope required');if(write&&request.auth?.role==='viewer')throw new ConfigError(403,'FORBIDDEN','Read-only access');for(const key of ['kb','document'])if(request.params[key]&&!z.string().uuid().safeParse(request.params[key]).success)throw new ConfigError(400,'INVALID_DOCUMENT_ID','Invalid document reference');await fn(request,response)}catch(error){if(error instanceof ConfigError)sendApiError(response,error.status,error.code,error.message);else if(error instanceof URIError)sendApiError(response,400,'INVALID_FILENAME','Invalid filename');else sendApiError(response,500,'KNOWLEDGE_OPERATION_FAILED','Knowledge operation failed')}}}
router.get('/:kb/documents',operation(async(req,res)=>{res.json({success:true,data:await new KnowledgeIngestion().list(req.orgId!,req.params.kb)})}))
router.get('/:kb/documents/:document/versions',operation(async(req,res)=>{const cursor=req.query.before===undefined?undefined:z.coerce.number().int().positive().safeParse(req.query.before);if(cursor&&!cursor.success)throw new ConfigError(400,'INVALID_VERSION_CURSOR','Invalid version cursor');res.json({success:true,...await new KnowledgeIngestion().history(req.orgId!,req.params.kb,req.params.document,cursor?.data)})}))
router.post('/:kb/documents',raw({type:'application/octet-stream',limit:MAX_DOCUMENT_BYTES}),operation(async(req,res)=>{
 if(!Buffer.isBuffer(req.body))throw new ConfigError(400,'DOCUMENT_BODY_REQUIRED','Upload a binary document')
 const filename=req.header('x-document-name')?decodeURIComponent(req.header('x-document-name')!):''
 const q=await new KnowledgeIngestion().enqueue(req.orgId!,req.params.kb,filename,req.body,null,req.auth!.userId)
 res.status(202).json({success:true,data:q});void new KnowledgeIngestion().processVersion(req.orgId!,q.versionId).catch(()=>console.error('[KNOWLEDGE] Background index failed; durable state retained'))
},true))
router.post('/:kb/documents/:document/versions',raw({type:'application/octet-stream',limit:MAX_DOCUMENT_BYTES}),operation(async(req,res)=>{
 if(!Buffer.isBuffer(req.body))throw new ConfigError(400,'DOCUMENT_BODY_REQUIRED','Upload a binary document')
 const filename=req.header('x-document-name')?decodeURIComponent(req.header('x-document-name')!):''
 const q=await new KnowledgeIngestion().enqueue(req.orgId!,req.params.kb,filename,req.body,req.params.document,req.auth!.userId)
 res.status(202).json({success:true,data:q});void new KnowledgeIngestion().processVersion(req.orgId!,q.versionId).catch(()=>console.error('[KNOWLEDGE] Background index failed; durable state retained'))
},true))
router.post('/:kb/documents/:document/reindex',operation(async(req,res)=>{const q=await new KnowledgeIngestion().reindex(req.orgId!,req.params.kb,req.params.document,req.auth!.userId);res.status(202).json({success:true,data:q});void new KnowledgeIngestion().processVersion(req.orgId!,q.versionId).catch(()=>console.error('[KNOWLEDGE] Background index failed; durable state retained'))},true))
router.patch('/:kb/documents/:document',operation(async(req,res)=>{const parsed=z.object({enabled:z.boolean()}).safeParse(req.body);if(!parsed.success)throw new ConfigError(400,'INVALID_DOCUMENT_UPDATE','Choose enabled or disabled');await new KnowledgeIngestion().setEnabled(req.orgId!,req.params.kb,req.params.document,parsed.data.enabled);res.json({success:true,data:{id:req.params.document,enabled:parsed.data.enabled}})},true))
router.delete('/:kb/documents/:document',operation(async(req,res)=>{await new KnowledgeIngestion().deleteDocument(req.params.document,req.params.kb,req.orgId!);res.json({success:true,data:{id:req.params.document,deleted:true}})},true))
router.post('/retrieval',operation(async(req,res)=>{
 const parsed=z.object({query:z.string().trim().min(1).max(2000),agentId:z.string().uuid()}).safeParse(req.body);if(!parsed.success)throw new ConfigError(400,'INVALID_RETRIEVAL','Choose an agent and enter a query')
 const agent=await agentVersionService.agent(req.orgId!,parsed.data.agentId)
 if(!agent.active||!agent.published_version_id)throw new ConfigError(409,'PUBLISHED_AGENT_REQUIRED','Select an active published agent')
 const version=await agentVersionService.version(req.orgId!,agent.id,agent.published_version_id)
 res.json({success:true,data:await new HybridRAG().retrieve(parsed.data.query,req.orgId!,version.id,version.config.knowledgeBaseIds)})
}))
router.use((error:unknown,_req:unknown,res:import('express').Response,_next:unknown)=>{if(error instanceof Error&&'status' in error&&error.status===413)sendApiError(res,413,'DOCUMENT_SIZE','Documents must be at most 2 MB');else sendApiError(res,400,'INVALID_DOCUMENT_REQUEST','Invalid document request')})
export default router
