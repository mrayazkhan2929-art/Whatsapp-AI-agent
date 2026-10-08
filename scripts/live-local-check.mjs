// Read-only verification of physical connection and durable encrypted credentials.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { createDecipheriv } from 'node:crypto'
const directory = resolve(import.meta.dirname, '../test-results/live-local')
const config = JSON.parse(readFileSync(resolve(directory, 'private-config.json'), 'utf8'))
const status = JSON.parse(readFileSync(resolve(directory, 'status.json'), 'utf8'))
const database = new pg.Client({ connectionString: `postgres://postgres:${config.password}@127.0.0.1:${config.dbPort}/postgres` })
try {
  await database.connect()
  const login = await fetch('http://127.0.0.1:' + config.supabasePort + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: config.email, password: config.ownerPassword }) })
  if (!login.ok) throw Error('Local identity login unavailable: ' + login.status)
  const identity = await login.json()
  const headers = { authorization: 'Bearer ' + identity.access_token }
  const me = await fetch(status.backendUrl + '/api/v1/auth/me', { headers })
  if (!me.ok) throw Error('Membership lookup unavailable: ' + me.status)
  const auth = (await me.json()).data
  const { rows } = await database.query('select d.id, d.status, (d.phone is not null and d.phone <> $2) phone_saved, (d.qr_code is null) qr_cleared, count(s.*)::int session_rows, bool_and(s.data !~ $3) not_plain_json from devices d left join baileys_sessions s on s.device_id=d.id and s.org_id=d.org_id where d.org_id=$1 group by d.id order by d.created_at', [auth.orgId, '', '^[\\[{]'])
  const devices = []
  for (const device of rows) {
    const response = await fetch(status.backendUrl + '/api/v1/devices/' + device.id, { headers })
    if (!response.ok) throw Error('Live runtime lookup unavailable: ' + response.status)
    const data = (await response.json()).data
    const saved = (await database.query("select data from baileys_sessions where device_id=$1 and org_id=$2 and key_type='creds' and key_id='creds'", [device.id, auth.orgId])).rows[0]
    let pairedCredentialsDecrypt = false
    if (saved) {
      const [iv, tag, cipher] = saved.data.split(':')
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), Buffer.from(iv, 'hex'))
      decipher.setAuthTag(Buffer.from(tag, 'hex'))
      const credentials = JSON.parse(Buffer.concat([decipher.update(Buffer.from(cipher, 'hex')), decipher.final()]).toString('utf8'))
      // Baileys Web login uses creds.me; registered is a separate mobile flag.
      pairedCredentialsDecrypt = Boolean(credentials.me?.id && credentials.noiseKey?.private && credentials.signedIdentityKey?.private)
    }
    devices.push({ ...device, pairedCredentialsDecrypt, runtimeStatus: data.runtimeStatus, isLiveConnected: data.isLiveConnected, health: data.health?.state ?? null })
  }
  const log = readFileSync(resolve(directory, 'backend.log'), 'utf8')
  const currentLog = log.slice(log.lastIndexOf('IERE WhatsApp backend running on port'))
  const result = { at: new Date().toISOString(), devices, liveConnectedCount: devices.filter(device => device.isLiveConnected).length, falseMissingSocketAlertsThisRun: (currentLog.match(/health_check_dead|state=missing/g) ?? []).length }
  writeFileSync(resolve(directory, 'physical-connection.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { await database.end() }
