import { proxyBackendRequest } from '@/lib/backend-api'
import { checkTenantReferences } from '@/lib/tenant'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/authenticate'
import { createServerClient } from '@/lib/supabase'

/** Compatibility adapter: agent selection, AI execution and persistence belong to the backend. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json()
    if (typeof body.message !== 'string' || !body.message.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })
    const supabase = createServerClient()
    const denial = await checkTenantReferences(supabase, auth.orgId, [['conversations', body.conversationId]])
    if (denial) return denial
    if (body.conversationId) {
      const { data: parent, error } = await supabase.from('conversations').select('contact_id').eq('id', body.conversationId).eq('org_id', auth.orgId).maybeSingle()
      if (error) return NextResponse.json({ error: 'Conversation lookup failed' }, { status: 500 })
      const contactDenial = await checkTenantReferences(supabase, auth.orgId, [['contacts', parent?.contact_id]])
      if (contactDenial) return contactDenial
    }
    return proxyBackendRequest(request, '/api/v1/chat', { method: 'POST', body: JSON.stringify({ message: body.message, conversationId: body.conversationId, history: body.history, deviceId: body.deviceId, phoneNumber: body.phoneNumber }) })
  } catch (error) {
    if (error instanceof NextResponse) return error
    return NextResponse.json({ error: 'Chat request failed' }, { status: error instanceof SyntaxError ? 400 : 500 })
  }
}
