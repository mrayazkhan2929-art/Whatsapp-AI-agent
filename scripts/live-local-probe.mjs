// Real HTTP login/device/QR probe. Never sends WhatsApp messages or simulates a scan.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const directory = resolve(import.meta.dirname, '../test-results/live-local')
const config = JSON.parse(readFileSync(resolve(directory, 'private-config.json'), 'utf8'))
const status = JSON.parse(readFileSync(resolve(directory, 'status.json'), 'utf8'))
if (status.status !== 'running') throw Error('Start the real local runtime first')
const evidencePath = resolve(directory, 'qr-verification.json')
const previous = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : {}
const results = { at: new Date().toISOString(), testRunnerUsed: false, realQrPreviouslyReceived: Boolean(previous.realQrImageReceived || previous.realQrPreviouslyReceived), physicalPairingVerified: false, messageRoundTripVerified: false }
const base = status.frontendUrl
const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: config.email, password: config.ownerPassword }) })
results.frontendLogin = login.status
if (!login.ok) throw Error('Login failed: ' + login.status)
const cookie = login.headers.getSetCookie().filter(value => !value.includes('Max-Age=0')).map(value => value.split(';')[0]).join('; ')
const headers = { cookie, origin: base, 'content-type': 'application/json' }
const me = await fetch(base + '/api/auth/me', { headers }); results.membership = me.status
if (!me.ok) throw Error('Membership denied: ' + me.status)
const devicePath = resolve(directory, 'device.json')
let device = existsSync(devicePath) ? JSON.parse(readFileSync(devicePath, 'utf8')) : null
if (!device) {
  const created = await fetch(base + '/api/devices', { method: 'POST', headers, body: JSON.stringify({ name: 'Real WhatsApp phone test' }) })
  results.createDevice = created.status
  if (!created.ok) throw Error('Device creation failed: ' + created.status)
  const body = await created.json(); device = { id: body.data.id }
  writeFileSync(devicePath, JSON.stringify(device, null, 2))
}
results.deviceId = device.id
const live = await fetch(base + '/api/devices', { headers })
if (!live.ok) throw Error('Device status unavailable (' + live.status + '); session left untouched. Wait before retrying.')
const liveBody = await live.json()
const paired = liveBody?.data?.find(item => item.isLiveConnected)
if (paired) {
  results.alreadyConnected = true; results.deviceId = paired.id; console.log('Device already connected; session preserved.')
  const probe = liveBody.data.find(item => item.id === device.id)
  if (process.argv.includes('--cleanup-probe') && paired.id !== device.id && probe && !probe.isLiveConnected && !probe.phone) {
    const cleanup = await fetch(base + '/api/devices/' + device.id + '/disconnect', { method: 'POST', headers, body: '{}' })
    if (!cleanup.ok) throw Error('Unpaired probe disconnect failed: ' + cleanup.status)
    results.unpairedProbeDisconnected = true
  }
}
else {
  const connected = await fetch(base + '/api/devices/' + device.id + '/connect', { method: 'POST', headers, body: '{}' })
  results.connectStatus = connected.status
  if (!connected.ok) { const body = await connected.json(); throw Error('Connect failed: ' + connected.status + ' ' + (body.error ?? body.message ?? body.code)) }
  let found = false
  for (let attempt = 0; attempt < 45; attempt++) {
    const response = await fetch(base + '/api/devices/' + device.id + '/qr', { headers })
    const body = await response.json()
    const data = body.data ?? body
    const png = data.qrImage ?? data.qrCode ?? data.qr_code
    if (typeof png === 'string' && png.startsWith('data:image/png;base64,')) {
      writeFileSync(resolve(directory, 'current-qr.png'), Buffer.from(png.split(',')[1], 'base64'))
      results.qrStatus = response.status; results.realQrImageReceived = true; found = true; break
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!found) throw Error('WhatsApp did not provide a QR within 45 seconds. Inspect local backend.log; no simulated QR was substituted.')
  console.log('Real WhatsApp QR received through frontend API. Open Devices and scan from WhatsApp > Linked devices.')
}
writeFileSync(evidencePath, JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results))
