import {readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
const verification=JSON.parse(readFileSync(resolve(root,'docs/phase5/verification.json'),'utf8'))
const gate=verification.find(entry=>entry.command==='npm run test:messages:db')
if(gate?.exitCode!==0||gate?.tests?.failed!==0||gate?.tests?.passed!==241)throw Error('Full current database gate must pass before promoting evidence')
const candidates=readdirSync(resolve(root,'test-results')).filter(name=>name.startsWith('phase5-db-')).sort((a,b)=>statSync(resolve(root,'test-results',b)).mtimeMs-statSync(resolve(root,'test-results',a)).mtimeMs)
const directory=candidates.find(name=>{try{return JSON.parse(readFileSync(resolve(root,'test-results',name,'message-http-evidence.json'),'utf8')).tenantBSnapshotChecks===28&&JSON.parse(readFileSync(resolve(root,'test-results',name,'property-http-evidence.json'),'utf8')).tenantBSnapshotChecks===52}catch{return false}})
if(!directory)throw Error('No complete combined current database evidence; do not promote partial runs')
const source=resolve(root,'test-results',directory)
const read=name=>JSON.parse(readFileSync(resolve(source,name),'utf8'))
const evidence={localStackDirectory:source,appliedToLiveProject:false,distribution:read('distribution.json'),migrations:read('migrations.json'),
 previousSecurityUpgrade:read('upgrade-check.json'),previousProfileUpgrade:read('profile-upgrade-check.json'),previousAgentUpgrade:read('agent-upgrade-check.json'),previousChannelUpgrade:read('channel-upgrade-check.json'),stateUpgrade:read('state-upgrade-check.json'),propertyUpgrade:read('property-upgrade-check.json'),messageUpgrade:read('message-upgrade-check.json'),
 tenantHttp:read('http-evidence.json'),companyHttp:read('company-http-evidence.json'),agentHttp:read('agent-http-evidence.json'),propertyHttp:read('property-http-evidence.json'),messageHttp:read('message-http-evidence.json')}
writeFileSync(resolve(root,'docs/phase5/database-evidence.json'),JSON.stringify(evidence,null,2)+'\n')
console.log('Promoted complete local database evidence without generated credentials from '+directory)
