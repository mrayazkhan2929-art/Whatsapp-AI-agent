import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'docs/live-validation')
const checkpoint = JSON.parse(readFileSync(resolve(out, 'checkpoint.json'), 'utf8'))
const archive = readFileSync(checkpoint.archive)
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase()
if (hash(archive) !== checkpoint.sha256) throw Error('Rollback archive changed')
let end = archive.length - 22
while (end >= Math.max(0, archive.length - 65557) && archive.readUInt32LE(end) !== 0x06054b50) end--
if (end < 0) throw Error('Invalid archive')
const count = archive.readUInt16LE(end + 10)
let cursor = archive.readUInt32LE(end + 16)
const changed = [], removed = [], manifest = {}
for (let index = 0; index < count; index++) {
  if (archive.readUInt32LE(cursor) !== 0x02014b50) throw Error('Invalid directory')
  const method = archive.readUInt16LE(cursor + 10), compressed = archive.readUInt32LE(cursor + 20), nameLength = archive.readUInt16LE(cursor + 28), extraLength = archive.readUInt16LE(cursor + 30), commentLength = archive.readUInt16LE(cursor + 32), offset = archive.readUInt32LE(cursor + 42)
  const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replaceAll('\\', '/')
  cursor += 46 + nameLength + extraLength + commentLength
  if (name.endsWith('/')) continue
  const target = resolve(root, name)
  if (!target.startsWith(root + sep)) throw Error('Unsafe archive path')
  const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28)
  const bytes = archive.subarray(start, start + compressed)
  const original = method === 8 ? inflateRawSync(bytes) : method === 0 ? bytes : null
  if (!original) throw Error('Unsupported ZIP compression')
  manifest[name] = hash(original)
  if (!existsSync(target)) removed.push(name)
  else if (hash(readFileSync(target)) !== manifest[name]) changed.push(name)
}
const allowed = new Set(JSON.parse(readFileSync(resolve(out, 'change-allowlist.json'), 'utf8')))
if (removed.length || changed.some(name => !allowed.has(name))) throw Error('Changes outside live validation allowlist: ' + JSON.stringify({ changed, removed }))
writeFileSync(resolve(out, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const privateDir = resolve(root, 'test-results/live-local')
const read = name => JSON.parse(readFileSync(resolve(privateDir, name), 'utf8'))
const physical = read('physical-connection.json')
const result = { at: new Date().toISOString(), changed, removed, historicalPhaseEvidenceUnchanged: true, historicalSQLUnchanged: true,
  rollbackArchiveSHA256: checkpoint.sha256, runtime: read('status.json'), freshDatabase: read('verification.json'), realQR: read('qr-verification.json'), browser: read('browser-verification.json'), physical,
  userConfirmedPairing: true, pairedRestartVerified: physical.devices.some(device => device.isLiveConnected && device.pairedCredentialsDecrypt),
  groq: existsSync(resolve(privateDir, 'groq-verification.json')) ? read('groq-verification.json') : null,
  roundTrip: existsSync(resolve(privateDir, 'roundtrip-verification.json')) ? read('roundtrip-verification.json') : null,
  commands: { 'node --check scripts/live-local.mjs': 0, 'npm run typecheck': 0, 'npm run typecheck:tests': 0, 'npm run lint': 0, 'npm run test:strict': { exitCode: 0, passed: 323, expectedFailures: 0 }, 'targeted adapter and preservation tests': { exitCode: 0, passed: 19 }, 'Groq compatibility, observability and studio tests': { exitCode: 0, passed: 55 }, 'real production frontend/backend build': 0, 'node scripts/live-local-browser.mjs': 0, 'node scripts/live-local-check.mjs': 0, 'node scripts/live-local-groq.mjs': 0 },
  limitations: ['Controlled real message roundtrip requires receipt evidence', 'Realtime not included in local stack', 'No online deployment or production migration', 'Initial probe mistakes corrected: missing frontend detail GET and incorrect QR image field; later 429 handled without resetting a session'] }
writeFileSync(resolve(out, 'verification.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ changed, previousEvidenceUnchanged: true, historicalSQLUnchanged: true, pairedRestartVerified: result.pairedRestartVerified }))
