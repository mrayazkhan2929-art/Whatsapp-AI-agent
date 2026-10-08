import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,openSync,closeSync,copyFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
// Wait for the complete combined gate before rebuilding the shared Next output.
for(let attempt=0;;attempt++){
 const result=JSON.parse(readFileSync(resolve(root,'docs/phase6/verification.json'),'utf8')).find(e=>e.command==='npm run test:handoffs:db')
 if(result){if(result.exitCode!==0)throw Error('Resolve the combined database gate before final UI verification');break}
 if(attempt>=600)throw Error('Timed out awaiting combined database verification')
 await new Promise(r=>setTimeout(r,1000))
}
const results=[]
for(const command of ['npm run typecheck','npm run typecheck:tests','npm run lint','npm run build','npm run test:all','npm run test:strict','node scripts/phase6-db.mjs tests/tenant-db/handoff-lifecycle.test.ts']){
 const name='final-'+command.replaceAll(':','-').replaceAll(' ','-').replaceAll('/','-')
 const log='docs/phase6/logs/'+name+'.log',descriptor=openSync(resolve(root,log),'w'),started=Date.now()
 console.log('Running final verification: '+command)
 const result=spawnSync(command,{cwd:root,shell:true,windowsHide:true,stdio:['ignore',descriptor,descriptor]});closeSync(descriptor)
 const entry={command,exitCode:result.status,seconds:Math.round((Date.now()-started)/100)/10,log}
 if(command.startsWith('node scripts/phase6-db')){const tests=JSON.parse(readFileSync(resolve(root,'test-results/phase6-tenant-db.json'),'utf8'));entry.tests={passed:tests.numPassedTests,failed:tests.numFailedTests,total:tests.numTotalTests};copyFileSync(resolve(root,'test-results/phase6-tenant-db.json'),resolve(root,'docs/phase6/logs/final-handoff-results.json'))}
 results.push(entry);writeFileSync(resolve(root,'docs/phase6/final-verification.json'),JSON.stringify(results,null,2)+'\n')
 console.log('Final '+command+': exit '+entry.exitCode)
 if(entry.exitCode!==0&&command!=='npm run lint')throw Error('Final verification failed: '+command)
}
process.exitCode=results.some(e=>e.exitCode!==0)?1:0
