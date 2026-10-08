import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
for(;;){const results=JSON.parse(readFileSync(resolve(root,'docs/phase7/verification.json'),'utf8'));if(results.some(r=>r.command==='npm run test:knowledge:db'))break;await new Promise(r=>setTimeout(r,5000))}
copyFileSync(resolve(root,'docs/phase7/verification.json'),resolve(root,'docs/phase7/verification-initial.json'))
const logs=resolve(root,'docs/phase7/logs'),initial=resolve(logs,'initial');mkdirSync(initial,{recursive:true})
for(const name of readdirSync(logs).filter(n=>n.startsWith('npm-')))copyFileSync(resolve(logs,name),resolve(initial,name))
console.log('Starting final clean verification on the completed Phase 7 source')
const result=spawnSync(process.execPath,[resolve(root,'scripts/phase7-verify.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1
