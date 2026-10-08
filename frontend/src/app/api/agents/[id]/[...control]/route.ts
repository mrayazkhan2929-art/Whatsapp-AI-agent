import { NextRequest, NextResponse } from 'next/server'
import { proxyBackendRequest } from '@/lib/backend-api'

type Context = { params: Promise<{ id: string; control: string[] }> }
async function proxy(request: NextRequest, context: Context) {
  const { id, control } = await context.params
  if (!control.length || control.length > 3) return NextResponse.json({ error: 'Route not found' }, { status: 404 })
  const path = '/api/v1/agents/' + [id, ...control].map(encodeURIComponent).join('/') + request.nextUrl.search
  return proxyBackendRequest(request, path, { method: request.method, body: request.method === 'GET' ? undefined : await request.text() })
}
export const GET = proxy
export const PATCH = proxy
export const POST = proxy
export const DELETE = proxy
