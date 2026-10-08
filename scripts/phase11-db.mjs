import { spawnSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import net from 'node:net'
import pg from 'pg'

const root = resolve(import.meta.dirname, '..')
const manualReview=process.argv.includes('--manual-review')
for (const file of ['', 'backend/', 'frontend/'].flatMap(prefix => ['', '.local', '.development', '.development.local', '.production', '.production.local', '.test', '.test.local'].map(suffix => prefix + '.env' + suffix))) {
  if (existsSync(resolve(root, file))) throw new Error('Database harness refuses live environment files: ' + file)
}
const directory = resolve(root, 'test-results/phase11-db-' + Date.now())
mkdirSync(directory, { recursive: true })
const project = 'wa-phase11-' + Date.now()
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
const [dbPort, authPort, restPort, apiPort, redisPort, mailPort, reviewFrontendPort] = await Promise.all(Array.from({ length: 7 }, freePort))
function jwt(role) {
  const body = [ { alg: 'HS256', typ: 'JWT' }, { role, iss: 'supabase', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+(manualReview?43200:7200) } ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url')
}
const base = 'https://raw.githubusercontent.com/supabase/supabase/self-hosted/v0.8.2/docker/volumes/db/'
for (const file of ['webhooks.sql', 'roles.sql', 'jwt.sql']) {
  const response = await fetch(base + file)
  if (!response.ok) throw new Error('Failed to fetch pinned Supabase bootstrap: ' + file)
  writeFileSync(resolve(directory, file), await response.text())
}
const config = { project, directory, redisPort, reviewFrontendPort, url: 'http://127.0.0.1:' + apiPort, dbUrl: `postgres://postgres:${password}@127.0.0.1:${dbPort}/postgres`, anonKey: jwt('anon'), serviceKey: jwt('service_role') }
const compose = { services: {
  mail:{image:'axllent/mailpit:v1.27.9@sha256:c17238042fcdd49d399934c56a42a896a32efdb857210556ea8b40cef4934f4c',ports:[`127.0.0.1:${mailPort}:8025`],environment:{MP_MAX_MESSAGES:'30',MP_DATABASE:'/tmp/mailpit.db'}},
  redis:{image:'redis:7.4.2-alpine@sha256:02419de7eddf55aa5bcf49efb74e88fa8d931b4d77c07eff8a6b2144472b6952',ports:[`127.0.0.1:${redisPort}:6379`],command:['redis-server','--save','','--appendonly','no'],healthcheck:{test:['CMD','redis-cli','ping'],interval:'2s',timeout:'3s',retries:30}},
  db: { image: 'supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00', ports: [`127.0.0.1:${dbPort}:5432`], environment: { POSTGRES_PASSWORD: password, PGPASSWORD: password, POSTGRES_DB: 'postgres', JWT_SECRET: secret, JWT_EXP: '3600' },
    volumes: [ `${directory.replaceAll('\\','/')}/webhooks.sql:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:ro`, `${directory.replaceAll('\\','/')}/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro`, `${directory.replaceAll('\\','/')}/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro` ],
    healthcheck: { test: ['CMD', 'pg_isready', '-U', 'postgres', '-h', 'localhost'], interval: '2s', timeout: '5s', retries: 60 } },
  auth: { image: 'supabase/gotrue:v2.196.0@sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232', ports: [`127.0.0.1:${authPort}:9999`], depends_on: { db: { condition: 'service_healthy' } }, environment: {
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: config.url + '/auth/v1', GOTRUE_SITE_URL: 'http://127.0.0.1:'+reviewFrontendPort+'/login',
    GOTRUE_SMTP_HOST:'mail',GOTRUE_SMTP_PORT:'1025',GOTRUE_SMTP_ADMIN_EMAIL:'local@phase11.example.invalid',GOTRUE_SMTP_SENDER_NAME:'Local test workspace',GOTRUE_MAILER_URLPATHS_CONFIRMATION:'/auth/v1/verify',GOTRUE_MAILER_EXTERNAL_HOSTS:'127.0.0.1',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@db:5432/postgres`, GOTRUE_JWT_ADMIN_ROLES: 'service_role', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_SECRET: secret, GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_DISABLE_SIGNUP: 'false' } },
  rest: { image: 'postgrest/postgrest:v14.17@sha256:c9dc201e555f5d8e37e7f39cdd4df0229774996e213bfd7de8d10ac609030f2c', ports: [`127.0.0.1:${restPort}:3000`], depends_on: { db: { condition: 'service_healthy' } }, environment: { PGRST_DB_URI: `postgres://authenticator:${password}@db:5432/postgres`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: secret } },
} }
config.mailUrl='http://127.0.0.1:'+mailPort
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
  let legacyStudioHistory
  let observabilitySnapshot
  let reliabilitySnapshot
  let legacyAgents, ambiguousUpgradeOrg, legacyHandoffConversations,legacyHandoffTeam
  let phase4UpgradeOrg,phase4UpgradeContact,phase4UpgradeConversation,phase4LegacyMemory,phase4LegacyProperties
  const notices=[]
  database.on('notice',notice=>notices.push(notice.message))
  for (const name of migrations) {
    if (name === '019_agent_versions.sql') {
      ambiguousUpgradeOrg = randomUUID()
      await database.query('insert into organizations(id,name,slug) values($1,$2,$3)',[ambiguousUpgradeOrg,'Ambiguous upgrade fixture','phase4-ambiguous-upgrade'])
      await database.query('insert into agents(org_id,name,system_prompt) values($1,$2,$3),($1,$4,$5)',[ambiguousUpgradeOrg,'First agent','First instructions','Second agent','Second instructions'])
      await database.query('insert into devices(org_id,name) values($1,$2)',[ambiguousUpgradeOrg,'Ambiguous upgrade device'])
      legacyAgents = (await database.query('select to_jsonb(a) as row from public.agents a order by id')).rows.map(item => item.row)
    }
    if(name==='025_handoff_lifecycle.sql'){
      const historicalTeam=randomUUID()
      await database.query("insert into team_members(id,org_id,name,role,whatsapp,email,active) values($1,$2,'Legacy handoff member','Agent','971500006888','legacy-phase11@example.invalid',false)",[historicalTeam,phase4UpgradeOrg])
      await database.query("update conversations set handled_by='human',assigned_to=$1 where id=$2 and org_id=$3",[historicalTeam,phase4UpgradeConversation,phase4UpgradeOrg])
      legacyHandoffConversations=(await database.query('select to_jsonb(c) row from conversations c order by id')).rows.map(r=>r.row)
      legacyHandoffTeam=(await database.query('select to_jsonb(t) row from team_members t order by id')).rows.map(r=>r.row)
    }
    let legacyMessages
    if(name==='023_message_idempotency.sql'){
      const historicalDevice=randomUUID()
      await database.query('insert into devices(id,org_id,name) values($1,$2,$3)',[historicalDevice,phase4UpgradeOrg,'Historical explicit device'])
      await database.query('update conversations set device_id=$1 where id=$2 and org_id=$3',[historicalDevice,phase4UpgradeConversation,phase4UpgradeOrg])
      config.phase5HistoricalDevice=historicalDevice;writeFileSync(resolve(directory,'config.json'),JSON.stringify(config))
      await database.query("insert into messages(org_id,conversation_id,direction,sender_type,content,wa_message_id) values($1,$2,'inbound','contact','Legacy one','legacy-duplicate'),($1,$2,'inbound','contact','Legacy two','legacy-duplicate'),($1,$2,'outbound','ai','Legacy no ID',null)",[phase4UpgradeOrg,phase4UpgradeConversation])
      legacyMessages=(await database.query('select to_jsonb(m) row from messages m order by id')).rows.map(r=>r.row)
    }
    let beforeProfileUpgrade
    if (name === "018_organization_profiles.sql") beforeProfileUpgrade = await dataFingerprint(database)
    let beforeUpgrade
    if(name==='021_conversation_state.sql'){
      phase4UpgradeOrg=randomUUID();phase4UpgradeContact=randomUUID();phase4UpgradeConversation=randomUUID()
      await database.query('insert into organizations(id,name,slug) values($1,$2,$3)',[phase4UpgradeOrg,'Property memory upgrade','phase4-property-upgrade'])
      await database.query('insert into contacts(id,org_id,phone,contact_memory) values($1,$2,$3,$4)',[phase4UpgradeContact,phase4UpgradeOrg,'+400000001',JSON.stringify({area:'Marina',bedrooms:'2',maxBudget:2000000,legacy_note:'preserve this value'})])
      await database.query('insert into conversations(id,org_id,contact_id) values($1,$2,$3)',[phase4UpgradeConversation,phase4UpgradeOrg,phase4UpgradeContact])
      await database.query('insert into contact_memory(contact_id,key,value) values($1,$2,$3)',[phase4UpgradeContact,'upgrade_note','preserve rows'])
      phase4LegacyMemory=(await database.query('select contact_memory from contacts where id=$1',[phase4UpgradeContact])).rows[0].contact_memory
      Object.assign(config,{phase4UpgradeOrg,phase4UpgradeContact,phase4UpgradeConversation});writeFileSync(resolve(directory,'config.json'),JSON.stringify(config))
    }
    if(name==='022_property_identity_and_media.sql'){
      await database.query("insert into properties(org_id,ref,ref_number,district,bedrooms,price_aed,image_urls) values($1,'LEGACY-1','ALIAS-DUP','Marina','2',1900000,$2),($1,'LEGACY-2','ALIAS-DUP','Marina','2',1950000,'{}')",[phase4UpgradeOrg,['https://cdn.example.invalid/legacy.jpg','https://127.0.0.1/private','javascript:alert(1)']])
      phase4LegacyProperties=(await database.query('select to_jsonb(p) row from properties p where org_id=$1 order by ref',[phase4UpgradeOrg])).rows.map(r=>r.row)
    }
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
    let legacyKnowledge
    if(name==='028_ai_observability.sql')observabilitySnapshot=await dataFingerprint(database);
    if(name==='027_agent_studio.sql')legacyStudioHistory=JSON.stringify((await database.query('select to_jsonb(v) row from agent_versions v order by id')).rows);
    if(name==='026_knowledge_documents.sql'){
      const kb=randomUUID(),org=phase4UpgradeOrg,vector=JSON.stringify([1,...Array(1535).fill(0)])
      await database.query('insert into knowledge_bases(id,org_id,name) values($1,$2,$3)',[kb,org,'Legacy preserved knowledge'])
      await database.query("insert into knowledge_chunks(org_id,knowledge_base_id,content,embedding,metadata) values($1,$2,'Legacy Arabic مرحبا',($3)::vector,$4),($1,$2,'Second legacy chunk',($3)::vector,$4)",[org,kb,vector,JSON.stringify({document_id:'legacy-import',source:'legacy.txt'})])
      legacyKnowledge=(await database.query('select to_jsonb(c) row from knowledge_chunks c order by id')).rows.map(r=>r.row)
    }
    console.log('Replaying ' + name)
    if(name==='030_device_runtime_leases.sql')reliabilitySnapshot=await dataFingerprint(database)
    const hardeningSnapshot=name==='031_rls_integrity_hardening.sql'?await dataFingerprint(database):null
    await database.query(readFileSync(resolve(root, 'supabase/migrations', name), 'utf8'))
    if(hardeningSnapshot){const after=await dataFingerprint(database);if(Object.entries(hardeningSnapshot).some(([table,value])=>JSON.stringify(value)!==JSON.stringify(after[table])))throw Error('Hardening migration changed historical rows');writeFileSync(resolve(directory,'hardening-upgrade-check.json'),JSON.stringify({historicalRowsPreserved:true,appliedToLiveProject:false},null,2))}
    if(name==='027_agent_studio.sql'){const preserved=legacyStudioHistory===JSON.stringify((await database.query('select to_jsonb(v) row from agent_versions v order by id')).rows);if(!preserved)throw Error('Studio migration changed immutable agent history');writeFileSync(resolve(directory,'studio-upgrade-check.json'),JSON.stringify({immutableAgentHistoryPreserved:preserved,appliedToLiveProject:false},null,2))}
    if(name==='026_knowledge_documents.sql'){
      const after=(await database.query('select to_jsonb(c) row from knowledge_chunks c order by id')).rows.map(r=>r.row)
      const preserved=JSON.stringify(after)===JSON.stringify(legacyKnowledge)
      const linked=(await database.query('select count(*)::int n from knowledge_document_chunks')).rows[0].n
      const expected=(await database.query('select count(*)::int n from knowledge_chunks c join knowledge_bases k on k.id=c.knowledge_base_id and k.org_id=c.org_id')).rows[0].n
      writeFileSync(resolve(directory,'knowledge-upgrade-check.json'),JSON.stringify({existingChunksAndEmbeddingsPreserved:preserved,linkedChunks:linked,expectedValidChunks:expected,appliedToLiveProject:false},null,2))
      if(!preserved||linked!==expected)throw Error('Knowledge migration failed lossless provenance backfill')
    }
    if(name==='025_handoff_lifecycle.sql'){
      const after=(await database.query("select to_jsonb(c)-'handoff_state'-'handoff_revision'-'handoff_due_at'-'handoff_reason' row from conversations c order by id")).rows.map(r=>r.row)
      const businessPreserved=JSON.stringify(after.map(({updated_at,...row})=>row))===JSON.stringify(legacyHandoffConversations.map(({updated_at,...row})=>row))
      const teamPreserved=JSON.stringify((await database.query('select to_jsonb(t) row from team_members t order by id')).rows.map(r=>r.row))===JSON.stringify(legacyHandoffTeam)
      const imported=(await database.query('select handoff_state,handled_by,assigned_to from conversations where id=$1',[phase4UpgradeConversation])).rows[0]
      const events=(await database.query("select count(*)::int n from handoff_events where conversation_id=$1 and event_type='legacy_cutover'",[phase4UpgradeConversation])).rows[0].n
      writeFileSync(resolve(directory,'handoff-upgrade-check.json'),JSON.stringify({businessColumnsPreserved:businessPreserved,teamPreserved,legacyHumanState:imported.handoff_state,legacyCompatibilityHandledBy:imported.handled_by,cutoverEvents:events,updatedAtMayReflectCutover:true,appliedToLiveProject:false},null,2))
      if(!businessPreserved||!teamPreserved||imported.handoff_state!=='HUMAN_ACTIVE'||imported.handled_by!=='human'||events!==1)throw Error('Handoff migration changed business data or failed cutover audit')
    }
    if(name==='023_message_idempotency.sql'){
      const rows=(await database.query("select to_jsonb(m)-'device_id'-'processing_status'-'processed_at'-'failure_code'-'claim_token'-'reply_to_message_id' row from messages m order by id")).rows.map(r=>r.row)
      const preserved=JSON.stringify(rows)===JSON.stringify(legacyMessages)
      const audit=notices.find(n=>n.startsWith('Message identity audit:'))
      const receipts=(await database.query('select count(*)::int n from message_receipts')).rows[0].n
      writeFileSync(resolve(directory,'message-upgrade-check.json'),JSON.stringify({existingMessagesPreserved:preserved,historicalDuplicateIDsRetained:true,noHistoricalIDsInvented:true,receipts,audit,appliedToLiveProject:false},null,2))
      if(!preserved||!audit||receipts!==1)throw Error('Message migration changed legacy messages or failed safe receipt backfill')
    }
    if(name==='021_conversation_state.sql'){
      const memory=(await database.query('select contact_memory from contacts where id=$1',[phase4UpgradeContact])).rows[0].contact_memory
      const rows=(await database.query('select count(*)::int count from conversation_states')).rows[0].count
      const preserved=JSON.stringify(memory)===JSON.stringify(phase4LegacyMemory)
      writeFileSync(resolve(directory,'state-upgrade-check.json'),JSON.stringify({legacyMemoryPreserved:preserved,statesBeforeLazyBackfill:rows,appliedToLiveProject:false},null,2))
      if(!preserved||rows!==0)throw Error('State migration altered legacy memory')
    }
    if(name==='022_property_identity_and_media.sql'){
      const rows=(await database.query("select to_jsonb(p)-'project'-'developer' row from properties p where org_id=$1 order by ref",[phase4UpgradeOrg])).rows.map(r=>r.row)
      const images=(await database.query('select media_type,url from property_media where org_id=$1',[phase4UpgradeOrg])).rows
      const preserved=JSON.stringify(rows)===JSON.stringify(phase4LegacyProperties)
      const audit=notices.find(n=>n.startsWith('Property identity audit:'))
      writeFileSync(resolve(directory,'property-upgrade-check.json'),JSON.stringify({legacyPropertiesPreserved:preserved,ambiguousAliasesRetained:true,audit,backfilledMedia:images,appliedToLiveProject:false},null,2))
      if(!preserved||!audit||images.length!==1||images[0].url!=='https://cdn.example.invalid/legacy.jpg')throw Error('Property identity/media upgrade failed preservation or safe backfill')
    }
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
    if(name==='030_device_runtime_leases.sql'){const after=await dataFingerprint(database);if(Object.entries(reliabilitySnapshot).some(([table,value])=>JSON.stringify(value)!==JSON.stringify(after[table])))throw Error('Runtime migration changed historical rows');writeFileSync(resolve(directory,'reliability-upgrade-check.json'),JSON.stringify({historicalRowsPreserved:true,appliedToLiveProject:false},null,2))}
    if(name==='029_audit_logs.sql'){const after=await dataFingerprint(database);const preserved=Object.entries(observabilitySnapshot).every(([table,value])=>JSON.stringify(value)===JSON.stringify(after[table]));if(!preserved)throw Error('Observability migration altered historical rows');writeFileSync(resolve(directory,'observability-upgrade-check.json'),JSON.stringify({historicalRowsPreserved:preserved,appliedToLiveProject:false},null,2))}
    applied.push(name)
  }
  await database.query("NOTIFY pgrst, 'reload schema'")
  writeFileSync(resolve(directory, 'migrations.json'), JSON.stringify({ applied, productionMigrationsAdded: 1, appliedToLiveProject: false }, null, 2))
  proxy = createServer(async (req, res) => {
    const isAuth = req.url.startsWith('/auth/v1/')
    const isRest = req.url.startsWith('/rest/v1/')
    if (!isAuth && !isRest) { res.writeHead(404); res.end(); return }
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const headers = { ...req.headers }; delete headers.host; delete headers['content-length']
      const upstream = await fetch(`http://127.0.0.1:${isAuth ? authPort : restPort}` + req.url.slice(isAuth ? 8 : 8), { method: req.method, headers, redirect:'manual', body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) })
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
  Object.assign(childEnv, { NODE_ENV: 'test', PHASE_REPORT_DIR: resolve(root,'docs/phase11/artifacts/company-regression'), PHASE_AGENT_REPORT_DIR: resolve(root,'docs/phase11/artifacts/agent-regression'), PHASE_PROPERTY_REPORT_DIR: resolve(root,'docs/phase11/artifacts/properties'), PHASE_TRANSPORT_REPORT_DIR: resolve(root,'docs/phase11/artifacts/transport'), PHASE_HANDOFF_REPORT_DIR: resolve(root,'docs/phase11/artifacts/handoffs'), PHASE_KNOWLEDGE_REPORT_DIR: resolve(root,'docs/phase11/artifacts/knowledge'), PHASE_STUDIO_REPORT_DIR: resolve(root,'docs/phase11/artifacts/studio'), PHASE_OBSERVABILITY_REPORT_DIR: resolve(root,'docs/phase11/artifacts/observability'), PHASE1_TEST_CONFIG: resolve(directory, 'config.json'), PHASE11_MANUAL_REVIEW:manualReview?'1':'0', SUPABASE_URL: config.url, SUPABASE_SERVICE_ROLE_KEY: config.serviceKey, SUPABASE_SERVICE_KEY: config.serviceKey, NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey, NEXT_TELEMETRY_DISABLED: '1', WA_SESSION_ENCRYPTION_KEY: randomBytes(32).toString('hex'), PHASE_RELIABILITY_REPORT_DIR: resolve(root,'docs/phase11/artifacts/reliability') })
  const child = spawn(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.phase11-db.config.ts', ...process.argv.slice(2).filter(value=>value!=='--manual-review')], { cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true })
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

