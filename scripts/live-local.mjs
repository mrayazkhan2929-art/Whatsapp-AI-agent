// Real application processes against isolated, persistent local Docker services.
// This deliberately imports no test runner and mocks no WhatsApp/provider methods.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, createHmac, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync, openSync, closeSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import net from 'node:net'
import pg from 'pg'
import { parse as parseEnv } from 'dotenv'

const root = resolve(import.meta.dirname, '..')
const directory = resolve(root, 'test-results/live-local')
const configPath = resolve(directory, 'private-config.json')
const statusPath = resolve(directory, 'status.json')
const stopPath = resolve(directory, 'stop')
const action = process.argv[2] ?? 'start'
mkdirSync(directory, { recursive: true })
const json = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
if (action === 'stop') { writeFileSync(stopPath, 'stop\n'); console.log('Requested real local runtime stop; database volumes and encryption key retained.'); process.exit(0) }
if (action === 'status') { console.log(existsSync(statusPath) ? readFileSync(statusPath, 'utf8') : 'Not started'); process.exit(0) }
if (!['start', 'background'].includes(action)) throw Error('Usage: node scripts/live-local.mjs [start|background|status|stop]')
if (existsSync(statusPath)) {
  const previous = JSON.parse(readFileSync(statusPath, 'utf8'))
  if (['starting', 'running'].includes(previous.status)) {
    let running = false
    try { process.kill(previous.pid, 0); running = true } catch {}
    if (running) throw Error('Real local runtime already active; use status or stop.')
  }
}
if (action === 'background') {
  const log = openSync(resolve(directory, 'runtime.log'), 'a')
  const child = spawn(process.execPath, [resolve(root, 'scripts/live-local.mjs'), 'start'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] })
  child.unref(); closeSync(log)
  console.log('Real runtime starting in background. Status: node scripts/live-local.mjs status')
  process.exit(0)
}
for (const prefix of ['', 'backend/', 'frontend/']) for (const suffix of ['', '.local', '.development', '.development.local', '.production', '.production.local']) {
  if (existsSync(resolve(root, prefix + '.env' + suffix))) throw Error('Refusing existing application environment: ' + prefix + '.env' + suffix)
}
if (existsSync(stopPath)) unlinkSync(stopPath)
const freePort = async () => {
  const server = net.createServer()
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  await new Promise(r => server.close(r))
  return port
}
let config
if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'))
else {
  const ports = await Promise.all(Array.from({ length: 8 }, freePort))
  const [dbPort, authPort, restPort, supabasePort, redisPort, mailPort, frontendPort, backendPort] = ports
  config = { project: 'wa-live-local-' + Date.now(), dbPort, authPort, restPort, supabasePort, redisPort, mailPort, frontendPort, backendPort,
    secret: randomBytes(32).toString('hex'), password: randomBytes(24).toString('hex'), encryptionKey: randomBytes(32).toString('hex'),
    email: 'owner@local.example.invalid', ownerPassword: randomBytes(24).toString('base64url') }
  json(configPath, config)
}
const frontendUrl = 'http://127.0.0.1:' + config.frontendPort
const backendUrl = 'http://127.0.0.1:' + config.backendPort
const supabaseUrl = 'http://127.0.0.1:' + config.supabasePort
const jwt = role => {
  const now = Math.floor(Date.now() / 1000)
  const body = [{ alg: 'HS256', typ: 'JWT' }, { role, iss: 'supabase', iat: now, exp: now + 86400 * 365 }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
  return body + '.' + createHmac('sha256', config.secret).update(body).digest('base64url')
}
const anonKey = jwt('anon'), serviceKey = jwt('service_role')
const composePath = resolve(directory, 'compose.json')
const bootstrapBase = 'https://raw.githubusercontent.com/supabase/supabase/self-hosted/v0.8.2/docker/volumes/db/'
for (const file of ['webhooks.sql', 'roles.sql', 'jwt.sql']) if (!existsSync(resolve(directory, file))) {
  const response = await fetch(bootstrapBase + file)
  if (!response.ok) throw Error('Pinned Supabase bootstrap unavailable: ' + file)
  writeFileSync(resolve(directory, file), await response.text())
}
const compose = { services: {
  mail: { image: 'axllent/mailpit:v1.27.9@sha256:c17238042fcdd49d399934c56a42a896a32efdb857210556ea8b40cef4934f4c', ports: [`127.0.0.1:${config.mailPort}:8025`] },
  redis: { image: 'redis:7.4.2-alpine@sha256:02419de7eddf55aa5bcf49efb74e88fa8d931b4d77c07eff8a6b2144472b6952', ports: [`127.0.0.1:${config.redisPort}:6379`], volumes: ['redis:/data'], command: ['redis-server', '--appendonly', 'yes'], healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '2s', timeout: '3s', retries: 30 } },
  db: { image: 'supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00', ports: [`127.0.0.1:${config.dbPort}:5432`], environment: { POSTGRES_PASSWORD: config.password, PGPASSWORD: config.password, POSTGRES_DB: 'postgres', JWT_SECRET: config.secret, JWT_EXP: '3600' },
    volumes: ['db:/var/lib/postgresql/data', ...['webhooks.sql', 'roles.sql', 'jwt.sql'].map(file => `${directory.replaceAll('\\', '/')}/${file}:/docker-entrypoint-initdb.d/init-scripts/${file === 'webhooks.sql' ? '98' : '99'}-${file}:ro`)], healthcheck: { test: ['CMD', 'pg_isready', '-U', 'postgres', '-h', 'localhost'], interval: '2s', timeout: '5s', retries: 60 } },
  auth: { image: 'supabase/gotrue:v2.196.0@sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232', ports: [`127.0.0.1:${config.authPort}:9999`], depends_on: { db: { condition: 'service_healthy' } }, environment: {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: supabaseUrl + '/auth/v1', GOTRUE_SITE_URL: frontendUrl + '/login', GOTRUE_SMTP_HOST: 'mail', GOTRUE_SMTP_PORT: '1025', GOTRUE_SMTP_ADMIN_EMAIL: 'local@example.invalid', GOTRUE_SMTP_SENDER_NAME: 'Real local workspace', GOTRUE_MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify', GOTRUE_MAILER_EXTERNAL_HOSTS: '127.0.0.1',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${config.password}@db:5432/postgres`, GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_SECRET: config.secret, GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_DISABLE_SIGNUP: 'false' } },
  rest: { image: 'postgrest/postgrest:v14.17@sha256:c9dc201e555f5d8e37e7f39cdd4df0229774996e213bfd7de8d10ac609030f2c', ports: [`127.0.0.1:${config.restPort}:3000`], depends_on: { db: { condition: 'service_healthy' } }, environment: { PGRST_DB_URI: `postgres://authenticator:${config.password}@db:5432/postgres`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: config.secret } },
}, volumes: { db: {}, redis: {} } }
json(composePath, compose)
const children = []
let database, proxy, stopping = false
let configuredProviders = []
const update = status => json(statusPath, { status, pid: process.pid, project: config.project, frontendUrl, backendUrl, realWhatsapp: true, mockedServices: [], providersConfigured: configuredProviders.length > 0, configuredProviders, realtimeAvailable: false, mailUrl: 'http://127.0.0.1:' + config.mailPort })
const docker = args => {
  const result = spawnSync('docker', ['compose', '-p', config.project, '-f', composePath, ...args], { encoding: 'utf8', windowsHide: true })
  writeFileSync(resolve(directory, 'docker-' + args[0] + '.log'), (result.stdout ?? '') + (result.stderr ?? ''))
  if (result.status !== 0) throw Error('Local Docker ' + args[0] + ' failed; inspect private runtime logs.')
}
const waitHttp = async (url, headers = {}) => {
  for (let i = 0; i < 90; i++) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) }).catch(() => null)
    if (response?.ok) return
    await new Promise(r => setTimeout(r, 1000))
  }
  throw Error('Service not ready: ' + url)
}
const runNode = (args, env, label) => {
  const log = openSync(resolve(directory, label + '.log'), 'a')
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', log, log], windowsHide: true })
  closeSync(log); children.push(child)
  child.on('error', () => { stopping = true })
  return child
}
process.on('SIGINT', () => { stopping = true }); process.on('SIGTERM', () => { stopping = true })
update('starting')
try {
  console.log('Starting real local application. WhatsApp is NOT mocked.'); docker(['up', '-d', '--wait', '--wait-timeout', '180'])
  database = new pg.Client({ connectionString: `postgres://postgres:${config.password}@127.0.0.1:${config.dbPort}/postgres` })
  await database.connect()
  await database.query('create schema if not exists local_runtime; create table if not exists local_runtime.migrations(name text primary key, sha256 text not null)')
  for (const name of readdirSync(resolve(root, 'supabase/migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort((a, b) => Number(a.match(/^\d+/)[0]) - Number(b.match(/^\d+/)[0]) || a.localeCompare(b, 'en'))) {
    const sql = readFileSync(resolve(root, 'supabase/migrations', name), 'utf8'), hash = createHash('sha256').update(sql).digest('hex')
    const previous = (await database.query('select sha256 from local_runtime.migrations where name=$1', [name])).rows[0]
    if (previous) { if (previous.sha256 !== hash) throw Error('Previously applied SQL changed: ' + name); continue }
    console.log('Applying fresh local migration ' + name)
    try { await database.query(sql) } catch (error) { throw Error('SQL replay failed at ' + name + ': ' + error.message) }
    await database.query('insert into local_runtime.migrations values($1,$2)', [name, hash])
  }
  await database.query("NOTIFY pgrst, 'reload schema'")
  proxy = createServer(async (req, res) => {
    const auth = req.url.startsWith('/auth/v1/'), rest = req.url.startsWith('/rest/v1/')
    if (!auth && !rest) { res.writeHead(404); res.end(); return }
    try {
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) { res.writeHead(413); res.end(); return }; chunks.push(chunk) }
      const headers = { ...req.headers }; delete headers.host; delete headers['content-length']
      const upstream = await fetch(`http://127.0.0.1:${auth ? config.authPort : config.restPort}` + req.url.slice(8), { method: req.method, headers, redirect: 'manual', body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), signal: AbortSignal.timeout(30000) })
      const responseHeaders = Object.fromEntries(upstream.headers); delete responseHeaders['content-encoding']; delete responseHeaders['content-length']
      res.writeHead(upstream.status, responseHeaders); res.end(Buffer.from(await upstream.arrayBuffer()))
    } catch { res.writeHead(503); res.end('Local service unavailable') }
  })
  await new Promise((r, reject) => { proxy.once('error', reject); proxy.listen(config.supabasePort, '127.0.0.1', r) })
  await waitHttp(supabaseUrl + '/auth/v1/health')
  await waitHttp(supabaseUrl + '/rest/v1/organizations?select=id&limit=1', { apikey: serviceKey, authorization: 'Bearer ' + serviceKey })
  const authHeaders = { apikey: serviceKey, authorization: 'Bearer ' + serviceKey, 'content-type': 'application/json' }
  let login = await fetch(supabaseUrl + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { ...authHeaders, apikey: anonKey }, body: JSON.stringify({ email: config.email, password: config.ownerPassword }) })
  if (!login.ok) {
    const created = await fetch(supabaseUrl + '/auth/v1/admin/users', { method: 'POST', headers: authHeaders, body: JSON.stringify({ email: config.email, password: config.ownerPassword, email_confirm: true }) })
    if (!created.ok) throw Error('Local owner creation failed (' + created.status + ')')
    const user = await created.json()
    await database.query('select public.onboard_organization($1,$2,$3)', [user.id, 'My real WhatsApp test workspace', 'Local Owner'])
  }
  const childEnv = { ...process.env }
  // Ensure inherited test/provider/database values cannot silently select a real account.
  for (const { name } of JSON.parse(readFileSync(resolve(root, 'docs/phase0/inventory.json'), 'utf8')).environment) delete childEnv[name]
  for (const name of Object.keys(childEnv)) if (/^(PHASE\d*_|VITEST|SUPABASE_|NEXT_PUBLIC_SUPABASE|ANTHROPIC_|CLAUDE_|GROQ_|OPENAI_|REDIS_|RESEND_|WA_SESSION_)/.test(name)) delete childEnv[name]
  Object.assign(childEnv, { NODE_ENV: 'production', SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey, SUPABASE_SERVICE_KEY: serviceKey, NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, BACKEND_URL: backendUrl, NEXT_PUBLIC_APP_URL: frontendUrl, NEXT_TELEMETRY_DISABLED: '1', REDIS_HOST: '127.0.0.1', REDIS_PORT: String(config.redisPort), WA_SESSION_ENCRYPTION_KEY: config.encryptionKey, TZ: 'Asia/Dubai' })
  const providerPath = resolve(directory, 'providers.env')
  if (existsSync(providerPath)) {
    const providerValues = parseEnv(readFileSync(providerPath))
    const permitted = new Set(['OPENAI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY'])
    if (Object.keys(providerValues).some(name => !permitted.has(name))) throw Error('providers.env accepts only OPENAI_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY')
    for (const [name, value] of Object.entries(providerValues)) if (value.trim()) childEnv[name] = value.trim()
    configuredProviders = Object.keys(providerValues).filter(name => Boolean(childEnv[name]))
  }
  const next = resolve(root, 'node_modules/next/dist/bin/next')
  const build = runNode([next, 'build', 'frontend'], childEnv, 'frontend-build')
  if (await new Promise(r => build.on('exit', code => r(code))) !== 0) throw Error('Frontend production build failed')
  const backendBuild = runNode([resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'backend/tsconfig.json'], childEnv, 'backend-build')
  if (await new Promise(r => backendBuild.on('exit', code => r(code))) !== 0) throw Error('Backend build failed')
  const backend = runNode([resolve(root, 'backend/dist/index.js')], { ...childEnv, HOST: '127.0.0.1', PORT: String(config.backendPort) }, 'backend')
  await waitHttp(backendUrl + '/healthz')
  const standaloneRoot = resolve(root, 'frontend/.next/standalone/frontend')
  cpSync(resolve(root, 'frontend/.next/static'), resolve(standaloneRoot, '.next/static'), { recursive: true })
  if (existsSync(resolve(root, 'frontend/public'))) cpSync(resolve(root, 'frontend/public'), resolve(standaloneRoot, 'public'), { recursive: true })
  const frontend = runNode([resolve(standaloneRoot, 'server.js')], { ...childEnv, PORT: String(config.frontendPort), HOSTNAME: '127.0.0.1' }, 'frontend')
  await waitHttp(frontendUrl + '/login')
  const authorized = await fetch(frontendUrl + '/api/auth/login', { method: 'POST', headers: { origin: frontendUrl, 'content-type': 'application/json' }, body: JSON.stringify({ email: config.email, password: config.ownerPassword }) })
  if (!authorized.ok) throw Error('Real frontend login failed (' + authorized.status + ')')
  writeFileSync(resolve(directory, 'LOCAL_ACCESS.md'), '# Real local access\n\nURL: ' + frontendUrl + '\n\nEmail: ' + config.email + '\n\nPassword: ' + config.ownerPassword + '\n\nThis is a local-only owner account. WhatsApp connections are real.\nNever publish this file or the private-config.json file.\n')
  json(resolve(directory, 'verification.json'), { at: new Date().toISOString(), actualBackendEntry: 'backend/dist/index.js', testRunnerUsed: false, loginStatus: authorized.status, migrations: (await database.query('select name from local_runtime.migrations order by name')).rows.map(r => r.name), physicalPhonePairingVerified: false, messageRoundTripVerified: false })
  update('running'); console.log('Ready: ' + frontendUrl + ' — actual WhatsApp gateway, persistent local DB. Credentials: test-results/live-local/LOCAL_ACCESS.md')
  while (!stopping && !existsSync(stopPath)) {
    if (backend.exitCode !== null || frontend.exitCode !== null) throw Error('Application process exited; inspect private logs')
    await new Promise(r => setTimeout(r, 1000))
  }
} catch (error) {
  console.error(error.message); update('failed'); process.exitCode = 1
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  await new Promise(r => setTimeout(r, 4000))
  await database?.end().catch(() => {})
  proxy?.closeAllConnections(); await new Promise(r => proxy ? proxy.close(r) : r())
  try { docker(['down', '--remove-orphans']) } catch (error) { console.error(error.message) }
  if (!process.exitCode) update('stopped')
  console.log('Stopped real runtime. Local persistent volumes/key retained; existing IERE containers untouched.')
}
