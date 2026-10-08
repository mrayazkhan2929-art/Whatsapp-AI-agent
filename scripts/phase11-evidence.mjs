import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'))
const gate=read('docs/phase11/verification.json').find(x=>x.command==='npm run test:hardening:db')
if(gate?.exitCode!==0||gate.tests?.passed!==492||gate.tests?.failed!==0||gate.tests?.total!==492)throw Error('Require the complete passing 492-case database gate')
const counts={'http-evidence':76,'company-http-evidence':41,'agent-http-evidence':44,'property-http-evidence':52,'message-http-evidence':28,'handoff-http-evidence':43,'knowledge-http-evidence':61,'studio-http-evidence':32,'observability-http-evidence':56,'reliability-http-evidence':42}
const directory=readdirSync(resolve(root,'test-results')).filter(name=>name.startsWith('phase11-db-')).sort((a,b)=>statSync(resolve(root,'test-results',b)).mtimeMs-statSync(resolve(root,'test-results',a)).mtimeMs).find(name=>{try{return Object.entries(counts).every(([file,n])=>read('test-results/'+name+'/'+file+'.json').tenantBSnapshotChecks===n)}catch{return false}})
if(!directory)throw Error('Complete per-suite tenant evidence missing')
const source='test-results/'+directory+'/'
const names=['upgrade-check','profile-upgrade-check','agent-upgrade-check','channel-upgrade-check','state-upgrade-check','property-upgrade-check','message-upgrade-check','handoff-upgrade-check','knowledge-upgrade-check','studio-upgrade-check','observability-upgrade-check','reliability-upgrade-check','hardening-upgrade-check']
const upgrades=Object.fromEntries(names.map(name=>[name,read(source+name+'.json')]))
if(!upgrades['hardening-upgrade-check'].historicalRowsPreserved||!upgrades['reliability-upgrade-check'].historicalRowsPreserved)throw Error('Populated upgrade preservation missing')
const hardening=read('docs/phase11/artifacts/hardening/evidence.json')
if(hardening.tenantBSnapshotChecks!==17||hardening.externalRequests||hardening.browserErrors.length||hardening.accessibility.some(x=>x.critical))throw Error('Hardening browser/tenant evidence incomplete')
const corpus=read(source+'observability-http-evidence.json').evaluationCases
if(corpus.length!==23||corpus.some(x=>!x.passed))throw Error('Evaluation corpus incomplete')
const migrations=read(source+'migrations.json');if(migrations.applied.length!==32)throw Error('Complete active migration replay missing')
writeFileSync(resolve(root,'docs/phase11/database-evidence.json'),JSON.stringify({localStackDirectory:resolve(root,source),appliedToLiveProject:false,distribution:read(source+'distribution.json'),migrations,upgrades,http:Object.fromEntries(Object.keys(counts).map(name=>[name,read(source+name+'.json')])),hardening,evaluationCases:corpus},null,2)+'\n')
console.log('Promoted sanitized 492-case local evidence; generated credentials remain excluded')
