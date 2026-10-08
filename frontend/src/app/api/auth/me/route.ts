import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/authenticate'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    return NextResponse.json({ data: auth })
  } catch (error) {
    if (error instanceof NextResponse) return error
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
