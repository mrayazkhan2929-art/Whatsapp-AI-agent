import {spawnSync} from 'node:child_process'
import {readFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),logs=resolve(root,'docs/phase7/logs')
for(;;){const results=JSON.parse(readFileSync(resolve(root,'docs/phase7/verification.json'),'utf8'));if(results.some(r=>r.command==='npm run test:knowledge:db'))break;await new Promise(r=>setTimeout(r,5000))}
await new Promise(r=>setTimeout(r,3000))
copyFileSync(resolve(root,'docs/phase7/verification.json'),resolve(root,'docs/phase7/verification-corrections.json'))
const previous=resolve(logs,'corrections');mkdirSync(previous,{recursive:true});for(const name of readdirSync(logs).filter(n=>n.startsWith('npm-')))copyFileSync(resolve(logs,name),resolve(previous,name))
console.log('Prior workers finished; starting complete clean verification')
const result=spawnSync(process.execPath,[resolve(root,'scripts/phase7-verify.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1
