import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),verification=JSON.parse(readFileSync(resolve(root,'docs/phase7/verification.json'),'utf8'))
const gate=verification.find(r=>r.command==='npm run test:knowledge:db')
if(gate?.exitCode!==0||gate.tests?.passed!==345||gate.tests?.failed!==0)throw Error('Require the complete final 345-test database gate before promoting evidence')
const final=JSON.parse(readFileSync(resolve(root,'docs/phase7/final-verification.json'),'utf8'))
if(final.exitCode!==0||final.tests?.passed!==61||final.tests?.failed!==0)throw Error('Require the final 61-test knowledge follow-up before promoting evidence')
const ui=JSON.parse(readFileSync(resolve(root,'docs/phase7/ui-verification.json'),'utf8'))
if(ui.length!==7||ui.some(r=>r.command!=='npm run lint'&&r.exitCode!==0))throw Error('Require complete final UI verification before promoting evidence')
const candidates=readdirSync(resolve(root,'test-results')).filter(n=>n.startsWith('phase7-db-')).sort((a,b)=>statSync(resolve(root,'test-results',b)).mtimeMs-statSync(resolve(root,'test-results',a)).mtimeMs)
const directory=candidates.find(n=>{try{const read=f=>JSON.parse(readFileSync(resolve(root,'test-results',n,f),'utf8'));return read('knowledge-http-evidence.json').tenantBSnapshotChecks===61&&read('message-http-evidence.json').tenantBSnapshotChecks===28&&read('handoff-http-evidence.json').tenantBSnapshotChecks===43&&read('property-http-evidence.json').tenantBSnapshotChecks===52}catch{return false}})
if(!directory)throw Error('Complete final database evidence missing')
const finalDirectory=candidates.find(n=>{try{return JSON.parse(readFileSync(resolve(root,'test-results',n,'knowledge-http-evidence.json'),'utf8')).tenantBSnapshotChecks===61}catch{return false}})
if(!finalDirectory||Number(finalDirectory.split('-').at(-1))<Number(directory.split('-').at(-1)))throw Error('Final knowledge follow-up evidence missing')
const source=resolve(root,'test-results',directory),read=f=>JSON.parse(readFileSync(resolve(source,f),'utf8'))
const evidence={localStackDirectory:source,appliedToLiveProject:false,distribution:read('distribution.json'),migrations:read('migrations.json'),knowledgeUpgrade:read('knowledge-upgrade-check.json'),knowledgeHttp:read('knowledge-http-evidence.json'),
 earlierUpgrades:Object.fromEntries(['upgrade-check','profile-upgrade-check','agent-upgrade-check','channel-upgrade-check','state-upgrade-check','property-upgrade-check','message-upgrade-check','handoff-upgrade-check'].map(name=>[name,read(name+'.json')])),
 earlierHttp:Object.fromEntries(['http-evidence','company-http-evidence','agent-http-evidence','property-http-evidence','message-http-evidence','handoff-http-evidence'].map(name=>[name,read(name+'.json')])),
 finalKnowledgeFollowUp:{verification:final,uiVerification:ui,localStackDirectory:resolve(root,'test-results',finalDirectory),knowledgeUpgrade:JSON.parse(readFileSync(resolve(root,'test-results',finalDirectory,'knowledge-upgrade-check.json'),'utf8')),knowledgeHttp:JSON.parse(readFileSync(resolve(root,'test-results',finalDirectory,'knowledge-http-evidence.json'),'utf8'))},
 layouts:Object.fromEntries(['desktop','mobile','rtl'].map(name=>[name,JSON.parse(readFileSync(resolve(root,'docs/phase7/artifacts/knowledge/layout-'+name+'.json'),'utf8'))]))}
writeFileSync(resolve(root,'docs/phase7/database-evidence.json'),JSON.stringify(evidence,null,2)+'\n')
console.log('Promoted final local evidence without generated credentials from '+directory)
