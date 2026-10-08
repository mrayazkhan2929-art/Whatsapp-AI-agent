// Read only the explicitly requested test marker; never expose phone/chat content.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
const directory = resolve(import.meta.dirname, '../test-results/live-local')
const config = JSON.parse(readFileSync(resolve(directory, 'private-config.json'), 'utf8'))
const status = JSON.parse(readFileSync(resolve(directory, 'status.json'), 'utf8'))
const login = await fetch('http://127.0.0.1:' + config.supabasePort + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: config.email, password: config.ownerPassword }) })
if (!login.ok) throw Error('Local identity unavailable: ' + login.status)
const identity = await login.json()
const me = await fetch(status.backendUrl + '/api/v1/auth/me', { headers: { authorization: 'Bearer ' + identity.access_token } })
if (!me.ok) throw Error('Membership unavailable: ' + me.status)
const auth = (await me.json()).data
const database = new pg.Client({ connectionString: `postgres://postgres:${config.password}@127.0.0.1:${config.dbPort}/postgres` })
try {
  await database.connect()
  const { rows } = await database.query(`select i.id, i.processing_status inbound_status, i.failure_code inbound_failure,
    count(o.*)::int outbound_count, bool_and(o.processing_status='completed') outbound_confirmed,
    bool_and(o.org_id=i.org_id and o.device_id=i.device_id and o.conversation_id=i.conversation_id) same_tenant_and_conversation,
    max(length(o.content)) reply_length
    from messages i left join messages o on o.reply_to_message_id=i.id and o.org_id=i.org_id
    where i.org_id=$1 and i.direction='inbound' and i.content ilike $2
    group by i.id order by i.created_at desc`, [auth.orgId, '%LOCAL-TEST-1008%'])
  const result = { at: new Date().toISOString(), marker: 'LOCAL-TEST-1008', inboundCount: rows.length, messages: rows, confirmedRoundTrips: rows.filter(row => row.outbound_count === 1 && row.outbound_confirmed && row.same_tenant_and_conversation).length }
  writeFileSync(resolve(directory, 'roundtrip-verification.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { await database.end() }
