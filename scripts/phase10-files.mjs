import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const checkpoint = JSON.parse(readFileSync(resolve(root,'docs/phase10/checkpoint.json'),'utf8'))
const archivePath = checkpoint.archive
const evidence = resolve(root, 'docs/phase10/file-changes.json')
mkdirSync(resolve(root, 'docs/phase10'), { recursive: true })
if (!existsSync(evidence)) writeFileSync(evidence, '{}\n')
const hash = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase()
const archive = readFileSync(archivePath)
if(hash(archive)!==checkpoint.sha256)throw Error('Rollback archive fingerprint changed')
// Read the ZIP central directory without extracting or changing any files.
let end = archive.length - 22
while (end >= Math.max(0, archive.length - 65557) && archive.readUInt32LE(end) !== 0x06054b50) end--
if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50) throw new Error('Invalid checkpoint ZIP')
const count = archive.readUInt16LE(end + 10)
let cursor = archive.readUInt32LE(end + 16)
const originals = new Map(), changed = [], removed = []
for (let index = 0; index < count; index++) {
  if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory')
  const method = archive.readUInt16LE(cursor + 10), compressed = archive.readUInt32LE(cursor + 20)
  const nameLength = archive.readUInt16LE(cursor + 28), extraLength = archive.readUInt16LE(cursor + 30), commentLength = archive.readUInt16LE(cursor + 32)
  const offset = archive.readUInt32LE(cursor + 42)
  const path = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replaceAll('\\', '/')
  cursor += 46 + nameLength + extraLength + commentLength
  if (path.endsWith('/')) continue
  const target = resolve(root, path)
  if (!target.startsWith(root + sep)) throw new Error('Checkpoint path escaped workspace')
  if (archive.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid ZIP entry')
  const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28)
  const bytes = archive.subarray(start, start + compressed)
  const content = method === 8 ? inflateRawSync(bytes) : method === 0 ? bytes : null
  if (!content) throw new Error('Unsupported ZIP compression')
  const originalHash = hash(content)
  originals.set(path, originalHash)
  if (!existsSync(target)) removed.push(path)
  else if (hash(readFileSync(target)) !== originalHash) changed.push(path)
}
const paths = execFileSync('rg', ['--files', '--hidden', '--no-ignore', '-g', '!**/node_modules/**', '-g', '!**/.next/**', '-g', '!**/dist/**', '-g', '!test-results/**', '-g', '!playwright-report/**', '-g', '!.git/**', '-g', '!**/*.tsbuildinfo', root], { cwd: root, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).map(path => relative(root, path).replaceAll('\\', '/'))
const created = paths.filter(path => !originals.has(path)).sort()
const changes = [...changed, ...removed, ...created]
if (changes.some(path => /^docs\/phase(?:[0-9])\//.test(path))) throw new Error('Historical phase evidence changed')
if ([...changed, ...removed].some(path => path.startsWith('supabase/migrations/') && path.endsWith('.sql'))) throw new Error('Historical SQL changed')
const result = {
  rollbackArchive: archivePath, rollbackSHA256: hash(archive), changed: changed.sort(),
  implementationChanged: changed.filter(path => path !== '.env.example' && path !== 'frontend/next-env.d.ts' && !path.endsWith('.tsbuildinfo')).sort(),
  unattributedConfigurationDrift: changed.filter(path => path === '.env.example'),
  generatedCacheChanges: changed.filter(path => path.endsWith('.tsbuildinfo') || path === 'frontend/next-env.d.ts'), created, removed,
  phase9EvidenceUnchanged: true, phase8EvidenceUnchanged: true, phase0EvidenceUnchanged: true, phase1EvidenceUnchanged: true, phase2EvidenceUnchanged: true, phase3EvidenceUnchanged: true, phase4EvidenceUnchanged: true, phase5EvidenceUnchanged: true, phase6EvidenceUnchanged: true, phase7EvidenceUnchanged: true, historicalSqlUnchanged: true,
  phase0ManifestSHA256: hash(readFileSync(resolve(root, 'docs/phase0/source-manifest.json'))),
  phase10ManifestSHA256: hash(readFileSync(resolve(root, 'docs/phase10/source-manifest.json'))),
}
writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n')
console.log(`${changed.length} changed, ${created.length} created, ${removed.length} removed; historical phase evidence and SQL unchanged`)
