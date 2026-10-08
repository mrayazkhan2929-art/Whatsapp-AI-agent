// Temporary loopback-only UI transfer for approved migration files and deployment credentials.
// Credentials remain in ignored test-results; this is not an application endpoint.
import { createServer } from 'node:http'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'test-results/deployment')
mkdirSync(out, { recursive: true })
const files = readdirSync(resolve(root, 'supabase/migrations')).filter(f => /^\d+.*\.sql$/.test(f)).sort((a,b) => Number(a.split('_')[0])-Number(b.split('_')[0]) || a.localeCompare(b))
const migrations = files.map(file => { const sql = readFileSync(resolve(root,'supabase/migrations',file),'utf8'); return {file, sql, sha256:createHash('sha256').update(sql).digest('hex')} })
writeFileSync(resolve(root, 'docs/deployment/migration-manifest.json'), JSON.stringify(migrations.map(({sql,...entry})=>entry),null,2)+'\n')
const csrf = randomBytes(24).toString('hex'), escape = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const server = createServer(async (req,res) => {
  const address = new URL(req.url,'http://127.0.0.1')
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; style-src 'unsafe-inline'")
  res.setHeader('Content-Type','text/html; charset=utf-8')
  if (req.method==='POST' && address.pathname==='/credentials') {
    if (req.headers.origin!==base) {res.writeHead(403); res.end('Invalid origin');return}
    let body=''; for await(const chunk of req) {body+=chunk;if(body.length>16000){res.writeHead(413);res.end();return}}
    const values=new URLSearchParams(body)
    if(values.get('csrf')!==csrf){res.writeHead(403);res.end('Invalid token');return}
    const payload={SUPABASE_URL:'https://jpfoebdljdyzoxznsgax.supabase.co',NEXT_PUBLIC_SUPABASE_URL:'https://jpfoebdljdyzoxznsgax.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:values.get('anon'),SUPABASE_SERVICE_ROLE_KEY:values.get('service'),WA_SESSION_ENCRYPTION_KEY:randomBytes(32).toString('hex')}
    if(!payload.NEXT_PUBLIC_SUPABASE_ANON_KEY || !payload.SUPABASE_SERVICE_ROLE_KEY){res.writeHead(400);res.end('Both existing project keys required');return}
    writeFileSync(resolve(out,'credentials.json'),JSON.stringify(payload,null,2)+'\n')
    res.end('<h1>Deployment credentials saved locally</h1><p>Values are kept out of source control and chat.</p>');return
  }
  if(address.pathname==='/credentials') {res.end(`<h1>Local deployment credentials</h1><form method="post" action="/credentials"><input type="hidden" name="csrf" value="${csrf}"><p><label>Public anon key <input name="anon" type="password" required></label></p><p><label>Server service role key <input name="service" type="password" required></label></p><button>Save locally</button></form>`);return}
  const index=Number(address.searchParams.get('index')??0), migration=migrations[index]
  if(!migration){res.writeHead(404);res.end('No migration');return}
  res.end(`<h1>Migration ${index+1} of ${migrations.length}: ${escape(migration.file)}</h1><p>SHA256 ${migration.sha256}</p><textarea aria-label="Migration SQL" style="width:100%;height:80vh">${escape(migration.sql)}</textarea>`)
})
let base
server.listen(0,'127.0.0.1',()=>{base='http://127.0.0.1:'+server.address().port;writeFileSync(resolve(out,'bridge.json'),JSON.stringify({url:base,pid:process.pid,files:files.length}));console.log(base)})
