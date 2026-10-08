import express from 'express'
import request from 'supertest'
import { beforeEach, expect, it, vi } from 'vitest'
import { requireAuth } from '../../backend/src/api/middleware/auth'
import { fakeSupabase } from '../support/fake-supabase'

const state = vi.hoisted(() => ({ db: null as any, identity: null as any }))
vi.mock('../../backend/src/config/supabase', () => ({ isSupabaseConfigured: () => true, getSupabaseAdmin: () => state.db }))
const app = express()
app.get('/me', requireAuth, (req: any, res) => res.json(req.auth))
const get = () => request(app).get('/me').set('Authorization', 'Bearer identity')
beforeEach(() => {
  state.identity = { id: 'auth-id', email: 'legacy@example.invalid', email_confirmed_at: '2026-01-01', app_metadata: { org_id: 'b', role: 'owner' }, user_metadata: { org_id: 'b' } }
  state.db = { ...fakeSupabase({ organizations: [{ id: 'a' }, { id: 'b' }], users: [{ id: 'legacy-id', org_id: 'a', email: state.identity.email, name: 'Stored member', role: 'viewer', active: true }] }), auth: { getUser: vi.fn(async () => ({ data: { user: state.identity }, error: null })) } }
})
it('unique confirmed legacy email resolves stored identity, organization, role and name', async () => {
  const before = structuredClone(state.db.tables.users)
  expect((await get()).body).toEqual({ userId: 'legacy-id', orgId: 'a', role: 'viewer', email: state.identity.email, name: 'Stored member' })
  expect(state.db.tables.users).toEqual(before)
})
it('direct membership wins over conflicting email and metadata', async () => {
  state.db.tables.users.push({ id: 'auth-id', org_id: 'a', active: true, role: 'admin', name: 'Direct', email: 'direct@example.invalid' })
  expect((await get()).body).toMatchObject({ userId: 'auth-id', orgId: 'a', role: 'admin' })
})
it('disabled direct membership cannot fall through to an active legacy match', async () => {
  state.db.tables.users.push({ id: 'auth-id', org_id: 'b', active: false, role: 'admin' })
  expect((await get()).status).toBe(403)
  expect(state.db.queries.some((q: any) => q.filters.some((f: any) => f[1] === 'email'))).toBe(false)
})
it.each([true, false])('duplicate email is denied even when second membership active=%s', async active => {
  state.db.tables.users.push({ ...state.db.tables.users[0], id: 'other', org_id: 'b', active })
  const before = structuredClone(state.db.tables.users)
  const response = await get()
  expect(response.status).toBe(403)
  expect(response.body.code).toBe('AMBIGUOUS_MEMBERSHIP')
  expect(state.db.tables.users).toEqual(before)
})
it('unconfirmed email cannot establish legacy membership', async () => {
  state.identity.email_confirmed_at = null
  expect((await get()).body.code).toBe('ONBOARDING_REQUIRED')
})
it.each(['disabled', 'missing organization', 'invalid role'])('rejects %s without creating mappings', async kind => {
  if (kind === 'disabled') state.db.tables.users[0].active = false
  if (kind === 'missing organization') state.db.tables.organizations = []
  if (kind === 'invalid role') state.db.tables.users[0].role = 'superuser'
  const before = structuredClone(state.db.tables.users)
  expect((await get()).status).toBe(403)
  expect(state.db.tables.users).toEqual(before)
})
it('lookup failure is a server failure, never a fallback', async () => {
  state.db.from = () => { throw new Error('DB unavailable') }
  expect((await get()).status).toBe(500)
})
it('Auth infrastructure failure is 503', async () => {
  state.db.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } })
  expect((await get()).status).toBe(503)
})
it('malformed explicit authorization cannot fall back to another cookie identity', async () => {
  expect((await request(app).get('/me').set('Authorization', 'malformed').set('Cookie', 'sb-access-token=identity')).status).toBe(401)
})
