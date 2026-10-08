import {spawnSync} from 'node:child_process'
import {closeSync,copyFileSync,openSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),started=Date.now(),log='docs/phase10/logs/indexing-recheck.log'
const descriptor=openSync(resolve(root,log),'w')
const result=spawnSync(process.execPath,[resolve(root,'scripts/phase10-db.mjs'),'tests/tenant-db/knowledge-lifecycle.test.ts','tests/tenant-db/device-reliability.test.ts'],{cwd:root,windowsHide:true,stdio:['ignore',descriptor,descriptor]})
closeSync(descriptor)
const file=resolve(root,'test-results/phase10-tenant-db.json')
if(statSync(file).mtimeMs<started)throw Error('Database recheck did not produce fresh results')
const tests=JSON.parse(readFileSync(file,'utf8'))
const directory=readdirSync(resolve(root,'test-results')).filter(name=>name.startsWith('phase10-db-')&&statSync(resolve(root,'test-results',name)).mtimeMs>=started).sort((a,b)=>statSync(resolve(root,'test-results',b)).mtimeMs-statSync(resolve(root,'test-results',a)).mtimeMs)[0]
if(!directory)throw Error('Fresh local stack evidence missing')
const evidence={command:'node scripts/phase10-db.mjs tests/tenant-db/knowledge-lifecycle.test.ts tests/tenant-db/device-reliability.test.ts',exitCode:result.status,seconds:Math.round((Date.now()-started)/100)/10,log,directory:resolve(root,'test-results',directory),tests:{passed:tests.numPassedTests,failed:tests.numFailedTests,total:tests.numTotalTests,pending:tests.numPendingTests}}
copyFileSync(file,resolve(root,'docs/phase10/logs/indexing-recheck-results.json'))
writeFileSync(resolve(root,'docs/phase10/indexing-recheck.json'),JSON.stringify(evidence,null,2)+'\n')
if(result.status!==0||tests.numPassedTests!==103||tests.numFailedTests||tests.numPendingTests)throw Error('Affected knowledge/reliability database recheck failed')
console.log('Affected database suites: 103 passed; zero failures or skipped tests')
