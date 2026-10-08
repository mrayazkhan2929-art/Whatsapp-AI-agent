import {spawnSync} from 'node:child_process'
import {openSync,closeSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
for(;;){const results=JSON.parse(readFileSync(resolve(root,'docs/phase7/verification.json'),'utf8'));const db=results.find(r=>r.command==='npm run test:knowledge:db');if(db){if(db.exitCode!==0||db.tests?.passed!==345)throw Error('Combined gate must pass before the final queue concurrency follow-up');break}await new Promise(r=>setTimeout(r,5000))}
const log=resolve(root,'docs/phase7/logs/final-knowledge-db.log'),fd=openSync(log,'w'),started=Date.now()
console.log('Running final knowledge database follow-up with tenant admission concurrency checks')
const r=spawnSync(process.execPath,[resolve(root,'scripts/phase7-db.mjs'),'tests/tenant-db/knowledge-lifecycle.test.ts'],{cwd:root,stdio:['ignore',fd,fd],windowsHide:true});closeSync(fd)
const result=JSON.parse(readFileSync(resolve(root,'test-results/phase7-tenant-db.json'),'utf8')),entry={command:'node scripts/phase7-db.mjs tests/tenant-db/knowledge-lifecycle.test.ts',exitCode:r.status,seconds:Math.round((Date.now()-started)/100)/10,tests:{passed:result.numPassedTests,failed:result.numFailedTests,total:result.numTotalTests},log:'docs/phase7/logs/final-knowledge-db.log'}
writeFileSync(resolve(root,'docs/phase7/final-verification.json'),JSON.stringify(entry,null,2)+'\n');copyFileSync(resolve(root,'test-results/phase7-tenant-db.json'),resolve(root,'docs/phase7/logs/final-knowledge-db-results.json'));console.log(JSON.stringify(entry));process.exitCode=r.status??1
