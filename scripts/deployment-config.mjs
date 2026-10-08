// Prepare ignored variable files for the already-approved Railway project.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
const root=resolve(import.meta.dirname,'..'), out=resolve(root,'test-results/deployment')
const credentials=JSON.parse(readFileSync(resolve(out,'credentials.json'),'utf8'))
const provider=parse(readFileSync(resolve(root,'test-results/live-local/providers.env'),'utf8'))
if(!provider.GROQ_API_KEY)throw Error('Configured Groq key missing')
for(const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY']){
 const claims=JSON.parse(Buffer.from(credentials[key].split('.')[1],'base64url'))
 if(claims.ref!=='jpfoebdljdyzoxznsgax'||claims.role!==(key.includes('ANON')?'anon':'service_role'))throw Error('Supabase project key mismatch')
}
const common={projectId:'bd88a483-41f3-41f9-88a2-69fafc8d3b55',environmentId:'4533cdb0-6452-4659-8354-8571542833d1',replace:false,skipDeploys:true}
const sets={backend:{serviceId:'c00145fe-f4b1-4c8d-b1cd-46bad4d3fc33',variables:{SUPABASE_URL:credentials.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:credentials.SUPABASE_SERVICE_ROLE_KEY,GROQ_API_KEY:provider.GROQ_API_KEY,WA_SESSION_ENCRYPTION_KEY:credentials.WA_SESSION_ENCRYPTION_KEY}},frontend:{serviceId:'e6c73bf5-fd98-4719-ba61-cba10eb06173',variables:{NEXT_PUBLIC_SUPABASE_URL:credentials.NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:credentials.NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:credentials.SUPABASE_SERVICE_ROLE_KEY}}}
for(const [service,values] of Object.entries(sets)){writeFileSync(resolve(out,service+'-variables.json'),JSON.stringify({input:{...common,...values}},null,2)+'\n');console.log(service+': '+Object.keys(values.variables).join(', '))}
