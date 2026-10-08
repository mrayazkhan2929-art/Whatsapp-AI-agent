import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '../../frontend/src/lib/authenticate'
import { GET } from '../../frontend/src/app/api/auth/me/route'
import { proxy } from '../../frontend/src/proxy'

const req = () => new NextRequest('http://localhost/dashboard', { headers: { authorization: 'Bearer fixture' } })
beforeEach(() => { process.env.BACKEND_URL = 'http://backend.example.invalid' })
it.each([401,403,500,503])('frontend me and page guard preserve backend failure %s', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'MEMBERSHIP_TEST', error: 'Fixture error' }, { status })))
  const me = await GET(req())
  expect(me.status).toBe(status)
  expect((await me.json()).code).toBe('MEMBERSHIP_TEST')
  const page = await proxy(req())
  expect(page.status).toBe(status === 401 ? 307 : status)
})
it('frontend uses authoritative backend context and forwards bearer identity', async () => {
  const auth = { userId:'u', orgId:'a', role:'member', email:'u@example.invalid', name:'Stored' }
  const fetchMock = vi.fn(async (..._args: unknown[]) => Response.json({ success:true, data:auth }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await requireAuth(req())).toEqual(auth)
  expect(fetchMock.mock.calls[0][0]).toBe('http://backend.example.invalid/api/v1/auth/me')
})
it('frontend denies invalid backend success payload', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success:true, data:{ orgId:'a' } })))
  await expect(requireAuth(req())).rejects.toBeInstanceOf(NextResponse)
  expect((await GET(req())).status).toBe(503)
})
it('frontend reports unreachable backend as 503', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline') }))
  expect((await GET(req())).status).toBe(503)
})
it('explicit empty authorization cannot fall back to the cookie identity', async () => {
  const fetchMock = vi.fn(async (_url:unknown,init?:RequestInit) => {
    expect(new Headers(init?.headers).get('authorization')).toBe('')
    return Response.json({ code:'UNAUTHORIZED' },{ status:401 })
  })
  vi.stubGlobal('fetch',fetchMock)
  const request = new NextRequest('http://localhost/api/auth/me',{ headers:{ authorization:'',cookie:'sb-access-token=valid-cookie' } })
  expect((await GET(request)).status).toBe(401)
})
