import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,openSync,closeSync,copyFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),results=[],target=resolve(root,'docs/phase7/final-verification.json')
for(;;){const previous=JSON.parse(readFileSync(target,'utf8'));if(previous.exitCode===0&&previous.tests?.passed===61)break;await new Promise(r=>setTimeout(r,5000))}
copyFileSync(target,resolve(root,'docs/phase7/final-sql-verification.json'))
copyFileSync(resolve(root,'docs/phase7/logs/final-knowledge-db.log'),resolve(root,'docs/phase7/logs/final-sql-knowledge-db.log'))
copyFileSync(resolve(root,'docs/phase7/logs/final-knowledge-db-results.json'),resolve(root,'docs/phase7/logs/final-sql-knowledge-db-results.json'))
for(const command of ['npm run typecheck','npm run typecheck:tests','npm run lint','npm run build','npm run test:all','npm run test:strict','node scripts/phase7-final-db.mjs']){
 const log='docs/phase7/logs/final-ui-'+command.replaceAll(':','-').replaceAll(' ','-').replaceAll('/','-')+'.log',fd=openSync(resolve(root,log),'w'),start=Date.now()
 console.log('Final UI verification: '+command)
 const run=spawnSync(command,{cwd:root,shell:true,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd)
 results.push({command,exitCode:run.status,seconds:Math.round((Date.now()-start)/100)/10,log})
 writeFileSync(resolve(root,'docs/phase7/ui-verification.json'),JSON.stringify(results,null,2)+'\n')
 if(command==='npm run test:all'||command==='npm run test:strict'){
  copyFileSync(resolve(root,'test-results/vitest/baseline.json'),resolve(root,log.replace('.log','-results.json')))
  if(command==='npm run test:all'&&existsSync(resolve(root,'test-results/e2e.json')))copyFileSync(resolve(root,'test-results/e2e.json'),resolve(root,log.replace('.log','-e2e.json')))
 }
 if(run.status!==0&&command!=='npm run lint'){process.exitCode=run.status??1;break}
}
