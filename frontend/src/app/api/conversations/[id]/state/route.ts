import { NextRequest } from 'next/server'
import { proxyBackendRequest } from '@/lib/backend-api'
export async function GET(request:NextRequest,context:{ params:Promise<{ id:string }> }) {
  const { id }=await context.params
  return proxyBackendRequest(request,'/api/v1/conversations/'+encodeURIComponent(id)+'/state',{ method:'GET' })
}
