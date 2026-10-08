import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (file) => readFileSync(resolve(root, file), 'utf8')
const hash = (file) => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')
function walk(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`
    return entry.isDirectory() ? walk(file) : [file]
  }).sort()
}
const migrations = readdirSync(resolve(root, 'supabase/migrations'))
  .filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort()
const packages = ['package.json', 'backend/package.json', 'frontend/package.json'].map((file) => ({
  file, ...JSON.parse(read(file)),
}))
const sourceFiles = [...walk('backend/src'), ...walk('frontend/src')]
const inventory = {
  source: 'Current workspace; SQL inventory is static evidence, not a live DB schema.',
  node: process.version,
  packages,
  migrations: migrations.map((name) => {
    const file = `supabase/migrations/${name}`
    const sql = read(file)
    return {
      file, sha256: hash(file),
      createdTables: [...sql.matchAll(/create table(?: if not exists)?\s+([\w.]+)/gi)].map((m) => m[1]),
      tableDefinitions: [...sql.matchAll(/create table(?: if not exists)?\s+[\w.]+\s*\([\s\S]*?\n\);/gi)].map((m) => m[0]),
      indexDefinitions: [...sql.matchAll(/create (?:unique )?index[\s\S]*?;/gi)].map((m) => m[0]),
      policyDefinitions: [...sql.matchAll(/create policy[\s\S]*?;/gi)].map((m) => m[0]),
      alters: [...sql.matchAll(/alter table\s+([\w.]+)[\s\S]*?;/gi)].map((m) => m[0]),
      destructiveStatements: [...sql.matchAll(/(?:delete from|drop table)\s+[\w.]+[\s\S]*?;/gi)].map((m) => m[0]),
    }
  }),
  duplicateMigrationPrefixes: [...new Set(migrations.map((f) => f.slice(0, 3)))].filter(
    (prefix) => migrations.filter((f) => f.startsWith(prefix)).length > 1,
  ),
  backendRoutes: [...walk('backend/src/api/routes'), 'backend/src/index.ts', 'backend/src/routes/health.ts'].flatMap(
    (file) => [...read(file).matchAll(/(?:router|app)\.(get|post|patch|put|delete|use)\(['"]([^'"]+)/g)]
      .map((m) => ({ file, line: read(file).slice(0, m.index).split('\n').length, method: m[1], path: m[2] })),
  ),
  frontendRoutes: walk('frontend/src/app').filter((f) => /\/(route|page)\.tsx?$/.test(f)).map((file) => ({
    file,
    methods: [...read(file).matchAll(/export (?:async )?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]),
  })),
  environment: sourceFiles.filter((f) => /\.tsx?$/.test(f)).flatMap((file) => {
    return [...new Set([...read(file).matchAll(/process\.env\.([A-Z][A-Z_0-9]*)/g)].map((m) => m[1]))]
      .map((name) => ({ name, file }))
  }),
  existingTestFiles: sourceFiles.filter((f) => /\.(test|spec)\./.test(f)),
  // Protect production source and migration history. This harness never updates this manifest on re-run.
}
const output = resolve(root, 'docs/phase0')
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n')
if (process.argv.includes('--capture')) {
  const protectedFiles = [...sourceFiles, ...walk('supabase/migrations'), 'backend/package.json',
    'frontend/package.json', 'backend/tsconfig.json', 'frontend/tsconfig.json',
    'frontend/next.config.ts', 'eslint.config.mjs', 'frontend/eslint.config.mjs']
  const manifest = resolve(output, 'source-manifest.json')
  // Never silently replace the rollback evidence.
  writeFileSync(manifest, JSON.stringify(Object.fromEntries(protectedFiles.map((f) => [f, hash(f)])), null, 2) + '\n', { flag: 'wx' })
}
console.log(`Inventory written to ${relative(root, output)}; ${migrations.length} active migrations, ${sourceFiles.length} source files.`)
