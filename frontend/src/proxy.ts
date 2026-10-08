import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from './lib/authenticate'

// Preserve authorization failures before protected pages render their shell.
export async function proxy(request: NextRequest) {
  try {
    await requireAuth(request)
    return NextResponse.next()
  } catch (error) {
    if (error instanceof NextResponse) {
      if (error.status === 401) return NextResponse.redirect(new URL('/login', request.url))
      return error
    }
    return NextResponse.json({ error: 'Authentication service unavailable' }, { status: 503 })
  }
}

export const config = {
  matcher: ['/', '/onboarding/:path*', '/team/:path*', '/execution-traces/:path*', '/ai-studio/:path*', '/dashboard/:path*', '/inbox/:path*', '/contacts/:path*', '/pipeline/:path*', '/properties/:path*', '/agents/:path*', '/analytics/:path*', '/knowledge-base/:path*', '/devices/:path*', '/settings/:path*', '/activity-log/:path*', '/bookings/:path*', '/flows/:path*', '/nudges/:path*', '/templates/:path*', '/team-performance/:path*'],
}
