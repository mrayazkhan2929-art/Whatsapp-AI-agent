import { NextRequest, NextResponse } from 'next/server'
import { proxyBackendRequest } from '@/lib/backend-api'
type Context = { params: Promise<{ path?: string[] }> }
export async function GET(request:NextRequest,context:Context) {
 const {path=[]}=await context.params
 if(path.length<1||path.length>2)return NextResponse.json({error:'Route not found'},{status:404})
 return proxyBackendRequest(request,'/api/v1/observability/'+path.map(encodeURIComponent).join('/')+request.nextUrl.search,{method:'GET'})
}
