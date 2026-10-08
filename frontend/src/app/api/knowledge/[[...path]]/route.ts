import {NextRequest,NextResponse} from 'next/server'
import {proxyBackendRequest} from '@/lib/backend-api'
type Context={params:Promise<{path?:string[]}>}
async function forward(request:NextRequest,context:Context){
 const {path=[]}=await context.params
 if(path.some(p=>!/^[-a-zA-Z0-9]+$/.test(p)))return NextResponse.json({error:'Invalid route'},{status:400})
 const binary=request.headers.get('content-type')==='application/octet-stream'
 let bytes:ArrayBuffer|undefined
 if(!['GET','HEAD'].includes(request.method)&&request.body){const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2*1024*1024){await reader.cancel();return NextResponse.json({error:'Documents must be at most 2 MB',code:'DOCUMENT_SIZE'},{status:413})}parts.push(part.value)}const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.byteLength}bytes=data.buffer}
 const headers=new Headers({'content-type':binary?'application/octet-stream':'application/json'})
 const name=request.headers.get('x-document-name');if(name)headers.set('x-document-name',name)
 return proxyBackendRequest(request,'/api/v1/knowledge'+(path.length?'/'+path.join('/'):'')+request.nextUrl.search,{method:request.method,headers,body:bytes})
}
export const GET=forward
export const POST=forward
export const PATCH=forward
export const DELETE=forward
