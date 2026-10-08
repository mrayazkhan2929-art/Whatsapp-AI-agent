import { spawnSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import net from 'node:net'
import pg from 'pg'

const root = resolve(import.meta.dirname, '..')
for (const file of ['', 'backend/', 'frontend/'].flatMap(prefix => ['', '.local', '.development', '.development.local', '.production', '.production.local', '.test', '.test.local'].map(suffix => prefix + '.env' + suffix))) {
  if (existsSync(resolve(root, file))) throw new Error('Database harness refuses live environment files: ' + file)
}
const directory = resolve(root, 'test-results/phase3-db-' + Date.now())
mkdirSync(directory, { recursive: true })
const project = 'wa-phase3-' + Date.now()
const composePath = resolve(directory, 'compose.json')
const secret = randomBytes(32).toString('hex')
const password = randomBytes(24).toString('hex')
const freePort = async () => {
  const socket = net.createServer()
  await new Promise(r => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port
  await new Promise(r => socket.close(r))
  return port
}
const [dbPort, authPort, restPort, apiPort] = await Promise.all(Array.from({ length: 4 }, freePort))
function jwt(role) {
  const body = [ { alg: 'HS256', typ: 'JWT' }, { role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+7200 } ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url')
}
const base = 'https://raw.githubusercontent.com/supabase/supabase/self-hosted/v0.8.2/docker/volumes/db/'
for (const file of ['webhooks.sql', 'roles.sql', 'jwt.sql']) {
  const response = await fetch(base + file)
  if (!response.ok) throw new Error('Failed to fetch pinned Supabase bootstrap: ' + file)
  writeFileSync(resolve(directory, file), await response.text())
}
const config = { project, directory, url: 'http://127.0.0.1:' + apiPort, dbUrl: `postgres://postgres:${password}@127.0.0.1:${dbPort}/postgres`, anonKey: jwt('anon'), serviceKey: jwt('service_role') }
const compose = { services: {
  db: { image: 'supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00', ports: [`127.0.0.1:${dbPort}:5432`], environment: { POSTGRES_PASSWORD: password, PGPASSWORD: password, POSTGRES_DB: 'postgres', JWT_SECRET: secret, JWT_EXP: '3600' },
    volumes: [ `${directory.replaceAll('\\','/')}/webhooks.sql:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:ro`, `${directory.replaceAll('\\','/')}/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro`, `${directory.replaceAll('\\','/')}/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro` ],
    healthcheck: { test: ['CMD', 'pg_isready', '-U', 'postgres', '-h', 'localhost'], interval: '2s', timeout: '5s', retries: 60 } },
  auth: { image: 'supabase/gotrue:v2.196.0@sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232', ports: [`127.0.0.1:${authPort}:9999`], depends_on: { db: { condition: 'service_healthy' } }, environment: {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: config.url + '/auth/v1', GOTRUE_SITE_URL: 'http://127.0.0.1',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@db:5432/postgres`, GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_SECRET: secret, GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_DISABLE_SIGNUP: 'false' } },
  rest: { image: 'postgrest/postgrest:v14.17@sha256:c9dc201e555f5d8e37e7f39cdd4df0229774996e213bfd7de8d10ac609030f2c', ports: [`127.0.0.1:${restPort}:3000`], depends_on: { db: { condition: 'service_healthy' } }, environment: { PGRST_DB_URI: `postgres://authenticator:${password}@db:5432/postgres`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret } },
} }
writeFileSync(composePath, JSON.stringify(compose, null, 2))
writeFileSync(resolve(directory,'distribution.json'),JSON.stringify({ distribution:'self-hosted/v0.8.2',bootstrapBase:base,images:Object.fromEntries(Object.entries(compose.services).map(([name,service]) => [name,service.image])),loopbackOnly:true },null,2))
writeFileSync(resolve(directory, 'config.json'), JSON.stringify(config))
const docker = args => {
  const result = spawnSync('docker', ['compose', '-p', project, '-f', composePath, ...args], { encoding: 'utf8', windowsHide: true })
  writeFileSync(resolve(directory, args[0]+'.log'), result.stdout + result.stderr)
  if (result.status !== 0) throw new Error('Disposable Docker command failed: ' + args[0] + '\n' + result.stderr)
}
let proxy, database
try {
  console.log('Starting pinned disposable DB/Auth/REST services: ' + project)
  docker(['up', '-d', '--wait', '--wait-timeout', '180'])
  database = new pg.Client({ connectionString: config.dbUrl })
  await database.connect()
  const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter(name => /^\d+.*\.sql$/.test(name)).sort()
  const applied = []
  let legacyAgents, ambiguousUpgradeOrg
  for (const name of migrations) {
    if (name === '019_agent_versions.sql') {
      ambiguousUpgradeOrg = randomUUID()
      await database.query('insert into organizations(id,name,slug) values($1,$2,$3)',[ambiguousUpgradeOrg,'Ambiguous upgrade fixture','phase3-ambiguous-upgrade'])
      await database.query('insert into agents(org_id,name,system_prompt) values($1,$2,$3),($1,$4,$5)',[ambiguousUpgradeOrg,'First agent','First instructions','Second agent','Second instructions'])
      await database.query('insert into devices(org_id,name) values($1,$2)',[ambiguousUpgradeOrg,'Ambiguous upgrade device'])
      legacyAgents = (await database.query('select to_jsonb(a) as row from public.agents a order by id')).rows.map(item => item.row)
    }
    let beforeProfileUpgrade
    if (name === "018_organization_profiles.sql") beforeProfileUpgrade = await dataFingerprint(database)
    let beforeUpgrade
    if (name === '017_tenant_data_api_guard.sql') {
      // Exercise the additive guard against populated historical objects too.
      const [org, contact, device, agent, flow] = Array.from({ length:5 }, randomUUID)
      await database.query('insert into organizations(id,name,slug) values($1,$2,$3)',[org,'Upgrade fixture','phase1-upgrade'])
      await database.query('insert into contacts(id,org_id,phone) values($1,$2,$3)',[contact,org,'+300000003'])
      await database.query('insert into devices(id,org_id,name) values($1,$2,$3)',[device,org,'Upgrade device'])
      await database.query('insert into agents(id,org_id,name,system_prompt) values($1,$2,$3,$4)',[agent,org,'Upgrade agent','Fixture'])
      await database.query('insert into flows(id,org_id,name,trigger_type) values($1,$2,$3,$4)',[flow,org,'Upgrade flow','keyword'])
      await database.query('insert into baileys_sessions(org_id,device_id,key_type,key_id,data) values($1,$2,$3,$4,$5)',[org,device,'fixture','upgrade','private fixture'])
      await database.query('insert into contact_memory(contact_id,key,value) values($1,$2,$3)',[contact,'upgrade','private fixture'])
      beforeUpgrade = await dataFingerprint(database)
    }
    console.log('Replaying ' + name)
    await database.query(readFileSync(resolve(root, 'supabase/migrations', name), 'utf8'))
    if (name === '019_agent_versions.sql') {
      const after = (await database.query("select to_jsonb(a)-'published_version_id' as row from public.agents a order by id")).rows.map(item => item.row)
      const versions = (await database.query('select a.id,a.published_version_id,v.config,v.version_number from public.agents a join public.agent_versions v on v.id=a.published_version_id and v.org_id=a.org_id and v.agent_id=a.id')).rows
      const preserved = JSON.stringify(legacyAgents) === JSON.stringify(after)
      const complete = versions.length === legacyAgents.length && versions.every(v => v.version_number === 1 && v.config.instructions === legacyAgents.find(a => a.id === v.id).system_prompt)
      writeFileSync(resolve(directory,'agent-upgrade-check.json'),JSON.stringify({ legacyColumnsPreserved:preserved, everyExistingAgentBackfilled:complete, existingAgents:legacyAgents.length, appliedToLiveProject:false },null,2))
      if (!preserved || !complete) throw new Error('Agent upgrade failed legacy preservation or version backfill')
    }
    if (name === '020_agent_runtime_links.sql') {
      const ambiguousLinks = (await database.query('select count(*)::int as count from public.agent_channel_links where org_id=$1',[ambiguousUpgradeOrg])).rows[0].count
      const soleLinks = (await database.query("select count(*)::int as count from public.agent_channel_links l join public.organizations o on o.id=l.org_id where o.slug='phase1-upgrade'")).rows[0].count
      writeFileSync(resolve(directory,'channel-upgrade-check.json'),JSON.stringify({ ambiguousOrganizationLinks:ambiguousLinks, singleAgentOrganizationLinks:soleLinks, arbitraryFallback:false },null,2))
      if (ambiguousLinks !== 0 || soleLinks !== 1) throw new Error('Unsafe or missing upgrade channel assignment')
    }
    if (beforeUpgrade) {
      const afterUpgrade = await dataFingerprint(database)
      const unchanged = JSON.stringify(beforeUpgrade) === JSON.stringify(afterUpgrade)
      writeFileSync(resolve(directory,'upgrade-check.json'),JSON.stringify({ migration:name, populatedTables:Object.keys(beforeUpgrade), dataUnchanged:unchanged, before:beforeUpgrade, after:afterUpgrade },null,2))
      if (!unchanged) throw new Error('Security migration changed existing row data')
    }
    if (beforeProfileUpgrade) {
      const after = await dataFingerprint(database)
      const unchanged = Object.keys(beforeProfileUpgrade).every(table => JSON.stringify(beforeProfileUpgrade[table]) === JSON.stringify(after[table]))
      const noBackfill = after.organization_profiles.count === 0
      writeFileSync(resolve(directory, 'profile-upgrade-check.json'), JSON.stringify({ migration: name, existingDataUnchanged: unchanged, noUnverifiedBackfill: noBackfill, before: beforeProfileUpgrade, after }, null, 2))
      if (!unchanged || !noBackfill) throw new Error('Company profile migration changed historical data or inserted unverified facts')
    }
    applied.push(name)
  }
  await database.query("NOTIFY pgrst, 'reload schema'")
  writeFileSync(resolve(directory, 'migrations.json'), JSON.stringify({ applied, productionMigrationsAdded: 2, appliedToLiveProject: false }, null, 2))
  proxy = createServer(async (req, res) => {
    const isAuth = req.url.startsWith('/auth/v1/')
    const isRest = req.url.startsWith('/rest/v1/')
    if (!isAuth && !isRest) { res.writeHead(404); res.end(); return }
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const headers = { ...req.headers }; delete headers.host; delete headers['content-length']
      const upstream = await fetch(`http://127.0.0.1:${isAuth ? authPort : restPort}` + req.url.slice(isAuth ? 8 : 8), { method: req.method, headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) })
      const responseHeaders = Object.fromEntries(upstream.headers); delete responseHeaders['content-encoding']; delete responseHeaders['content-length']
      res.writeHead(upstream.status, responseHeaders); res.end(Buffer.from(await upstream.arrayBuffer()))
    } catch { res.writeHead(503); res.end('Local test service unavailable') }
  })
  await new Promise(r => proxy.listen(apiPort, '127.0.0.1', r))
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(config.url + '/auth/v1/health').catch(() => null)
    if (response?.ok) break
    if (attempt === 59) throw new Error('Local Auth did not become ready')
    await new Promise(r => setTimeout(r, 1000))
  }
  const childEnv = { ...process.env }
  const inventory = JSON.parse(readFileSync(resolve(root, 'docs/phase0/inventory.json'), 'utf8'))
  for (const { name } of inventory.environment) delete childEnv[name]
  Object.assign(childEnv, { NODE_ENV: 'test', PHASE_REPORT_DIR: resolve(root,'docs/phase3/artifacts/company-regression'), PHASE1_TEST_CONFIG: resolve(directory, 'config.json'), SUPABASE_URL: config.url, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey, SUPABASE_SERVICE_KEY: config.serviceKey, NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey, NEXT_TELEMETRY_DISABLED: '1' })
  const child = spawn(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.phase3-db.config.ts', ...process.argv.slice(2)], { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true })
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)) })
} finally {
  await database?.end().catch(() => {})
  if (proxy) await new Promise(r => proxy.close(r))
  try { docker(['logs', '--no-color', '--tail', '500']) }
  finally { docker(['down', '--volumes', '--remove-orphans']) }
  console.log('Removed disposable stack; retained evidence in ' + directory)
}

async function dataFingerprint(client) {
  const { rows } = await client.query("select tablename from pg_tables where schemaname='public' order by tablename")
  const snapshot = {}
  for (const { tablename } of rows) {
    const { rows:data } = await client.query('select to_jsonb(t)::text as row from public."'+tablename.replaceAll('"','""')+'" t order by to_jsonb(t)::text')
    snapshot[tablename] = { count:data.length, sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex') }
  }
  return snapshot
}
