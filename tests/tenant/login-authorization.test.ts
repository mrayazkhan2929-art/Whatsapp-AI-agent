import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '../../frontend/src/app/api/auth/login/route'

const dependencies = vi.hoisted(() => ({ signIn:vi.fn(),authorize:vi.fn() }))
vi.mock('@supabase/supabase-js',() => ({ createClient:() => ({ auth:{ signInWithPassword:dependencies.signIn } }) }))
vi.mock('../../frontend/src/lib/authenticate',() => ({ resolveAuthToken:dependencies.authorize }))
const login = () => POST(new NextRequest('http://localhost/api/auth/login',{ method:'POST',body:JSON.stringify({ email:'fixture@example.invalid',password:'fixture' }) }))
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fixture'
  dependencies.signIn.mockResolvedValue({ data:{ session:{ access_token:'token',refresh_token:'refresh' },user:{ id:'user',email:'fixture@example.invalid' } },error:null })
  dependencies.authorize.mockReset()
})
it.each([403,500,503])('login preserves membership failure %s without setting cookies', async status => {
  dependencies.authorize.mockRejectedValue(NextResponse.json({ code:'MEMBERSHIP_TEST' },{ status }))
  const response = await login()
  expect(response.status).toBe(status)
  expect(response.headers.has('set-cookie')).toBe(false)
})
it('login reports unavailable Supabase Auth as 503 without cookies', async () => {
  dependencies.signIn.mockResolvedValue({ data:{ session:null },error:{ status:503,name:'AuthRetryableFetchError' } })
  const response = await login()
  expect(response.status).toBe(503)
  expect(response.headers.has('set-cookie')).toBe(false)
  expect(dependencies.authorize).not.toHaveBeenCalled()
})
it('login reports invalid credentials as 401 without authorizing', async () => {
  dependencies.signIn.mockResolvedValue({ data:{ session:null },error:{ status:400,name:'AuthApiError' } })
  expect((await login()).status).toBe(401)
  expect(dependencies.authorize).not.toHaveBeenCalled()
})
it('authorized login preserves successful envelope and secure cookie behavior', async () => {
  const response = await POST(new NextRequest('https://localhost/api/auth/login',{ method:'POST',body:JSON.stringify({ email:'fixture@example.invalid',password:'fixture' }) }))
  expect(response.status).toBe(200)
  expect(dependencies.authorize).toHaveBeenCalledWith('token')
  expect(await response.json()).toMatchObject({ success:true,user:{ id:'user' } })
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(response.headers.get('set-cookie')).toContain('Secure')
})
