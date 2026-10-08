import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/authenticate'
import { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  let auth
  try { auth = await requireAuth(request) } catch (error) {
    if (error instanceof NextResponse) return error
    return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 })
  }
  const supabase = createServerClient()
  const { error } = await supabase.from('organizations').select('id').eq('id', auth.orgId).limit(1)
  return NextResponse.json({
    status: error ? 'degraded' : 'ok',
    version: '4.1.0',
    timestamp: new Date().toISOString(),
    timezone: 'Asia/Dubai',
    services: {
      database: error ? 'error' : 'ok',
      ai:
        process.env.ANTHROPIC_API_KEY ||
        process.env.CLAUDE_API_KEY ||
        process.env.ANTHROPIC_KEY ||
        process.env.CLAUDE_KEY
          ? 'configured'
          : 'missing',
      whatsapp: 'see backend service on :3001',
    }
  })
}
