import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthToken } from '@/lib/authenticate'
import { isSameOrigin } from '@/lib/request-origin'

function shouldUseSecureCookies(request: NextRequest): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto')

  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() === 'https'
  }

  return request.nextUrl.protocol === 'https:'
}

export async function POST(request: NextRequest) {
  if(!isSameOrigin(request))return NextResponse.json({error:'Invalid request origin',code:'FORBIDDEN'},{status:403})
  let payload: unknown
  try { payload = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    const { email, password } = payload as Record<string, unknown>
    if (typeof email!=='string'||email.length>254||!email||typeof password!=='string'||password.length>256||!password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase auth is not configured' }, { status: 503 })
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const { data, error } = await authClient.auth.signInWithPassword({ email, password })

    if (error || !data.session) {
      if (error && (error.status === 0 || (error.status ?? 0) >= 500 || error.name === 'AuthRetryableFetchError')) {
        return NextResponse.json({ error:'Authentication service unavailable',code:'AUTH_UNAVAILABLE' },{ status:503 })
      }
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    await resolveAuthToken(data.session.access_token)

    const response = NextResponse.json({
      success: true,
      user: { id: data.user.id, email: data.user.email },
    })

    const cookieOptions = {
      httpOnly: true,
      secure: shouldUseSecureCookies(request),
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    }

    response.cookies.delete('sb-access-token')
    response.cookies.delete('sb-refresh-token')
    response.cookies.set('sb-access-token', data.session.access_token, cookieOptions)
    response.cookies.set('sb-refresh-token', data.session.refresh_token, cookieOptions)

    return response
  } catch (error) {
    if (error instanceof NextResponse) return error
    console.error('POST /api/auth/login error:', error)
    return NextResponse.json(
      {
        error: 'Login failed',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 },
    )
  }
}
