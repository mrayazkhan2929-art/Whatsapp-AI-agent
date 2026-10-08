import { NextRequest, NextResponse } from 'next/server'
import { proxyBackendRequest } from './backend-api'
import { isSameOrigin } from './request-origin'

export interface AuthContext {
  userId: string
  orgId: string
  role: string
  email: string
  name: string
}

export async function resolveAuthToken(token: string): Promise<AuthContext> {
  return requireAuth(new NextRequest('http://localhost/api/auth/me', { headers: { authorization: `Bearer ${token}` } }))
}

export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!isSameOrigin(request)){
    throw NextResponse.json({error:'Invalid request origin',code:'FORBIDDEN'},{status:403})
  }
  if (!request.headers.has('authorization') && !request.cookies.get('sb-access-token')?.value) {
    throw NextResponse.json({ error: 'Authentication required', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  const response = await proxyBackendRequest(request, '/api/v1/auth/me')
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw NextResponse.json(body ?? { error: 'Authentication service unavailable' }, { status: response.status })
  }
  const auth = body?.data
  if (!auth || !['userId', 'orgId', 'role', 'email', 'name'].every(key => typeof auth[key] === 'string')) {
    throw NextResponse.json({ error: 'Invalid authentication response', code: 'AUTH_UNAVAILABLE' }, { status: 503 })
  }
  const mutation=!['GET','HEAD','OPTIONS'].includes(request.method)
  const adminArea=/^\/api\/(?:v1\/)?(?:settings|team|agents|flows|devices)(?:\/|$)/.test(request.nextUrl.pathname)
  if(mutation&&(auth.role==='viewer'||(adminArea&&!['owner','admin'].includes(auth.role)))){
    throw NextResponse.json({error:'Your role cannot change this resource',code:'FORBIDDEN'},{status:403})
  }
  return auth as AuthContext
}

export function withAuth(handler: (req: NextRequest, ctx: AuthContext) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    try {
      return await handler(req, await requireAuth(req))
    } catch (err) {
      if (err instanceof NextResponse) return err
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}

