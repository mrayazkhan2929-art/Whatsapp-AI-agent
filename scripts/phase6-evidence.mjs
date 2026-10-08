import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
const verification=JSON.parse(readFileSync(resolve(root,'docs/phase6/verification.json'),'utf8'))
const gate=verification.find(entry=>entry.command==='npm run test:handoffs:db')
if(gate?.exitCode!==0||gate?.tests?.failed!==0||gate?.tests?.passed!==284)throw Error('Full current database gate must pass before promoting evidence')
const candidates=readdirSync(resolve(root,'test-results')).filter(name=>name.startsWith('phase6-db-')).sort((a,b)=>statSync(resolve(root,'test-results',b)).mtimeMs-statSync(resolve(root,'test-results',a)).mtimeMs)
const directory=candidates.find(name=>{try{return JSON.parse(readFileSync(resolve(root,'test-results',name,'message-http-evidence.json'),'utf8')).tenantBSnapshotChecks===28&&JSON.parse(readFileSync(resolve(root,'test-results',name,'handoff-http-evidence.json'),'utf8')).tenantBSnapshotChecks===43&&JSON.parse(readFileSync(resolve(root,'test-results',name,'property-http-evidence.json'),'utf8')).tenantBSnapshotChecks===52}catch{return false}})
if(!directory)throw Error('No complete combined current database evidence; do not promote partial runs')
const source=resolve(root,'test-results',directory)
const read=name=>JSON.parse(readFileSync(resolve(source,name),'utf8'))
const evidence={localStackDirectory:source,appliedToLiveProject:false,distribution:read('distribution.json'),migrations:read('migrations.json'),
 previousSecurityUpgrade:read('upgrade-check.json'),previousProfileUpgrade:read('profile-upgrade-check.json'),previousAgentUpgrade:read('agent-upgrade-check.json'),previousChannelUpgrade:read('channel-upgrade-check.json'),stateUpgrade:read('state-upgrade-check.json'),propertyUpgrade:read('property-upgrade-check.json'),messageUpgrade:read('message-upgrade-check.json'),handoffUpgrade:read('handoff-upgrade-check.json'),
 tenantHttp:read('http-evidence.json'),companyHttp:read('company-http-evidence.json'),agentHttp:read('agent-http-evidence.json'),propertyHttp:read('property-http-evidence.json'),messageHttp:read('message-http-evidence.json'),handoffHttp:read('handoff-http-evidence.json')}
const finalVerification=JSON.parse(readFileSync(resolve(root,'docs/phase6/final-verification.json'),'utf8'))
const finalGate=finalVerification.find(entry=>entry.command==='node scripts/phase6-db.mjs tests/tenant-db/handoff-lifecycle.test.ts')
if(finalGate?.exitCode!==0||finalGate?.tests?.passed!==43||finalGate?.tests?.failed!==0)throw Error('Final handoff verification must pass before promoting final evidence')
const finalDirectory=candidates.find(name=>{try{return JSON.parse(readFileSync(resolve(root,'test-results',name,'handoff-http-evidence.json'),'utf8')).tenantBSnapshotChecks===43}catch{return false}})
if(!finalDirectory)throw Error('Final handoff evidence missing')
const finalSource=resolve(root,'test-results',finalDirectory)
evidence.finalHandoffFollowup={localStackDirectory:finalSource,command:finalGate.command,tests:finalGate.tests,
  handoffHttp:JSON.parse(readFileSync(resolve(finalSource,'handoff-http-evidence.json'),'utf8')),
  handoffUpgrade:JSON.parse(readFileSync(resolve(finalSource,'handoff-upgrade-check.json'),'utf8')),
  layouts:Object.fromEntries(['desktop','mobile','rtl'].map(name=>[name,JSON.parse(readFileSync(resolve(root,'docs/phase6/artifacts/handoffs',`layout-${name}.json`),'utf8'))]))}
writeFileSync(resolve(root,'docs/phase6/database-evidence.json'),JSON.stringify(evidence,null,2)+'\n')
console.log('Promoted complete local database evidence without generated credentials from '+directory)
