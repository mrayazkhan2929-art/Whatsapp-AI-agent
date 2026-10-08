import { NextRequest } from 'next/server'
import { proxyBackendRequest } from '@/lib/backend-api'

export async function GET(request: NextRequest) {
  return proxyBackendRequest(request, '/api/v1/settings/company-profile')
}
export async function PATCH(request: NextRequest) {
  return proxyBackendRequest(request, '/api/v1/settings/company-profile', { method: 'PATCH', body: await request.text() })
}
