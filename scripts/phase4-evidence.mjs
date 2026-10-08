import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
const candidates=readdirSync(resolve(root,'test-results')).filter(name=>name.startsWith('phase4-db-')).sort((a,b)=>statSync(resolve(root,'test-results',b)).mtimeMs-statSync(resolve(root,'test-results',a)).mtimeMs)
const directory=candidates.find(name=>{try{const report=JSON.parse(readFileSync(resolve(root,'test-results',name,'property-http-evidence.json'),'utf8'));return report.tenantBSnapshotChecks===52}catch{return false}})
if(!directory)throw Error('No complete current property/database evidence; do not promote partial runs')
const source=resolve(root,'test-results',directory)
const read=name=>JSON.parse(readFileSync(resolve(source,name),'utf8'))
const verification=JSON.parse(readFileSync(resolve(root,'docs/phase4/verification.json'),'utf8'))
const dbGate=verification.find(entry=>entry.command==='npm run test:properties:db')
if(dbGate?.exitCode!==0 || dbGate?.tests?.passed!==213 || dbGate?.tests?.failed!==0)throw Error('Current full database gate must pass before promoting evidence')
const evidence={
  localStackDirectory:source,appliedToLiveProject:false,distribution:read('distribution.json'),migrations:read('migrations.json'),
  previousSecurityUpgrade:read('upgrade-check.json'),previousProfileUpgrade:read('profile-upgrade-check.json'),
  previousAgentUpgrade:read('agent-upgrade-check.json'),previousChannelUpgrade:read('channel-upgrade-check.json'),
  stateUpgrade:read('state-upgrade-check.json'),propertyUpgrade:read('property-upgrade-check.json'),
  tenantHttp:read('http-evidence.json'),companyHttp:read('company-http-evidence.json'),agentHttp:read('agent-http-evidence.json'),propertyHttp:read('property-http-evidence.json'),
}
writeFileSync(resolve(root,'docs/phase4/database-evidence.json'),JSON.stringify(evidence,null,2)+'\n')
console.log('Promoted validated local evidence without credentials from '+directory)
