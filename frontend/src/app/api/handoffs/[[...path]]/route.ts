import { NextRequest,NextResponse } from 'next/server'
import { proxyBackendRequest } from '@/lib/backend-api'
type Context={params:Promise<{path?:string[]}>}
async function forward(request:NextRequest,context:Context){
 const {path=[]}=await context.params
 if(path.some(p=>!/^[-a-zA-Z0-9]+$/.test(p)))return NextResponse.json({error:'Invalid route'},{status:400})
 return proxyBackendRequest(request,'/api/v1/handoffs'+(path.length?'/'+path.join('/'):'')+request.nextUrl.search,{method:request.method,body:['GET','HEAD'].includes(request.method)?undefined:await request.text()})
}
export const GET=forward
export const POST=forward
export const PATCH=forward
export const DELETE=forward
