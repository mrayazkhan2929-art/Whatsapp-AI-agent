// Targeted verification after the final low-impact badge contrast/copy adjustment.
import {spawnSync} from 'node:child_process'
import {mkdirSync,openSync,closeSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'docs/phase5/logs')
mkdirSync(output,{recursive:true})
const commands=[
 ['typecheck','npm run typecheck'],['test-typecheck','npm run typecheck:tests'],['build','npm run build'],
 ['unit','npm run test:unit'],['all','npm run test:all'],
 ['lint','npx eslint frontend/src/components/inbox/TransportStatus.tsx frontend/src/components/inbox/MessageThread.tsx "frontend/src/app/api/v1/messages/[id]/route.ts" frontend/src/app/api/conversations/route.ts'],
 ['browser','npm run test:messages:db -- tests/tenant-db/message-idempotency.test.ts -t "shows clear delivery review"'],
]
const results=[]
for(const[name,command]of commands){
 const log='docs/phase5/logs/final-ui-'+name+'.log',fd=openSync(resolve(root,log),'w'),start=Date.now()
 console.log('Running '+command)
 const result=spawnSync(command,{cwd:root,shell:true,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd)
 const entry={command,exitCode:result.status,seconds:Math.round((Date.now()-start)/100)/10,log}
 if(name==='unit'||name==='all'){const report=JSON.parse(readFileSync(resolve(root,'test-results/vitest/baseline.json'),'utf8'));entry.tests={passed:report.passed,expectedFailures:report.expectedFailures,failed:report.failed,moduleErrors:report.moduleErrors};copyFileSync(resolve(root,'test-results/vitest/baseline.json'),resolve(output,'final-ui-'+name+'-results.json'))}
 if(name==='browser'){const report=JSON.parse(readFileSync(resolve(root,'test-results/phase5-tenant-db.json'),'utf8'));entry.tests={passed:report.numPassedTests,failed:report.numFailedTests,total:report.numTotalTests,pending:report.numPendingTests};copyFileSync(resolve(root,'test-results/phase5-tenant-db.json'),resolve(output,'final-ui-browser-results.json'))}
 results.push(entry);writeFileSync(resolve(root,'docs/phase5/final-ui-verification.json'),JSON.stringify(results,null,2)+'\n')
 console.log(command+': exit '+entry.exitCode)
 if(entry.exitCode!==0)break
}
process.exitCode=results.some(r=>r.exitCode!==0)?1:0
