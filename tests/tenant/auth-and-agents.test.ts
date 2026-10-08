import express from 'express'
import request from 'supertest'
import { beforeEach, expect, it, vi } from 'vitest'
import { requireAuth } from '../../backend/src/api/middleware/auth'
import { requireOrgScope } from '../../backend/src/api/middleware/orgScope'
import agentsRouter from '../../backend/src/api/routes/agents'
import { fakeSupabase } from '../support/fake-supabase'

const dependency = vi.hoisted(() => ({ db: null as any, getUser: vi.fn() }))
vi.mock('../../backend/src/config/supabase', () => ({ isSupabaseConfigured: () => true, getSupabaseAdmin: () => dependency.db }))
const app = express()
app.use(express.json())
app.use('/agents', requireAuth, requireOrgScope, agentsRouter)

beforeEach(() => {
  dependency.db = { ...fakeSupabase({
    organizations: [{ id: 'tenant-a' }, { id: 'tenant-b' }],
    users: [{ id: 'user-a', org_id: 'tenant-a', role: 'admin', email: 'a@example.invalid', active: true }],
    agents: [{ id: 'agent-a', org_id: 'tenant-a', name: 'A' }, { id: 'agent-b', org_id: 'tenant-b', name: 'B' }],
  }), auth: { getUser: dependency.getUser } }
  dependency.getUser.mockResolvedValue({ data: { user: { id: 'user-a', email: 'a@example.invalid', app_metadata: {} } }, error: null })
})
it('missing token is denied before accessing tenant data', async () => {
  expect((await request(app).get('/agents')).status).toBe(401)
  expect(dependency.getUser).not.toHaveBeenCalled()
})
it('invalid token is denied', async () => {
  dependency.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid token' } })
  expect((await request(app).get('/agents').set('Authorization', 'Bearer forged')).status).toBe(401)
})
it('real auth/org middleware and agents route ignore a forged query organization', async () => {
  const response = await request(app).get('/agents?orgId=tenant-b&org_id=tenant-b').set('Authorization', 'Bearer fixture')
  expect(response.status).toBe(200)
  expect(response.body.data).toEqual([{ id: 'agent-a', org_id: 'tenant-a', name: 'A' }])
  expect(dependency.db.queries.find((q: any) => q.table === 'agents').filters).toContainEqual(['eq', 'org_id', 'tenant-a'])
})
it('tenant A cannot read tenant B agent by ID at the application query boundary', async () => {
  const response = await request(app).get('/agents/agent-b').set('Authorization', 'Bearer fixture')
  expect(response.status).toBe(404)
  expect(response.body.code).toBe('AGENT_NOT_FOUND')
})
it('P1 unmapped authenticated user must receive 403 instead of the first organization', async () => {
  dependency.getUser.mockResolvedValue({ data: { user: { id: 'unknown', email: 'unknown@example.invalid', app_metadata: {} } }, error: null })
  const response = await request(app).get('/agents').set('Authorization', 'Bearer fixture-unknown')
  expect(response.status).toBe(403)
  expect(dependency.db.queries.some((q: any) => q.table === 'organizations')).toBe(false)
})
it('P1 disabled application member must receive 403', async () => {
  dependency.db.tables.users[0].active = false
  expect((await request(app).get('/agents').set('Authorization', 'Bearer fixture-disabled')).status).toBe(403)
})
