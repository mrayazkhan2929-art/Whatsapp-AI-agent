import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const verification = read('docs/phase10/verification.json')
const gate = verification.find(entry => entry.command === 'npm run test:reliability:db')
if (gate?.exitCode !== 0 || gate.tests?.passed !== 475 || gate.tests?.failed !== 0 || gate.tests?.total !== 475) {
  throw new Error('Require the complete passing 475-test database gate before promoting evidence')
}
const counts = { 'http-evidence': 76, 'company-http-evidence': 41, 'agent-http-evidence': 44, 'property-http-evidence': 52, 'message-http-evidence': 28, 'handoff-http-evidence': 43, 'knowledge-http-evidence': 61, 'studio-http-evidence': 32, 'observability-http-evidence': 56, 'reliability-http-evidence':42 }
const candidates = readdirSync(resolve(root, 'test-results')).filter(name => name.startsWith('phase10-db-'))
  .sort((a, b) => statSync(resolve(root, 'test-results', b)).mtimeMs - statSync(resolve(root, 'test-results', a)).mtimeMs)
const directory = candidates.find(name => {
  try {
    return Object.entries(counts).every(([file, count]) => read('test-results/' + name + '/' + file + '.json').tenantBSnapshotChecks === count)
  } catch { return false }
})
if (!directory) throw new Error('Complete database HTTP evidence missing')
const source = 'test-results/' + directory + '/'
const recheck=read('docs/phase10/indexing-recheck.json')
if(recheck.exitCode!==0||recheck.tests.passed!==103||recheck.tests.failed||recheck.tests.pending)throw Error('Affected indexing/reliability recheck missing')
const refreshed=path=>JSON.parse(readFileSync(resolve(recheck.directory,path),'utf8'))
if(refreshed('knowledge-http-evidence.json').tenantBSnapshotChecks!==61||refreshed('reliability-http-evidence.json').tenantBSnapshotChecks!==42||!refreshed('reliability-upgrade-check.json').historicalRowsPreserved)throw Error('Affected-suite preservation evidence missing')
const migrations = read(source + 'migrations.json')
const upgrade = read(source + 'observability-upgrade-check.json')
const reliabilityUpgrade=read(source+'reliability-upgrade-check.json')
const corpus = read(source + 'observability-http-evidence.json').evaluationCases
if(corpus.length!==23||new Set(corpus.map(item=>item.category)).size!==23||corpus.some(item=>!item.passed))throw Error('Complete evaluation corpus evidence missing')
if (!upgrade.historicalRowsPreserved||!reliabilityUpgrade.historicalRowsPreserved) throw new Error('Historical row preservation missing')
// Deliberately select only sanitized evidence files; never copy config.json or compose credentials.
const evidence = {
  localStackDirectory: resolve(root, source), appliedToLiveProject: false,
  distribution: read(source + 'distribution.json'), migrations, observabilityUpgrade: upgrade, reliabilityUpgrade,
  affectedSuitesRechecked:recheck,
  http: Object.fromEntries(Object.keys(counts).map(name => [name, ['knowledge-http-evidence','reliability-http-evidence'].includes(name)?refreshed(name+'.json'):read(source + name + '.json')])),
  earlierUpgrades: Object.fromEntries(['upgrade-check', 'profile-upgrade-check', 'agent-upgrade-check', 'channel-upgrade-check', 'state-upgrade-check', 'property-upgrade-check', 'message-upgrade-check', 'handoff-upgrade-check', 'knowledge-upgrade-check','studio-upgrade-check'].map(name => [name, read(source + name + '.json')])),
  screenshotsReviewed: ['device-runtime-desktop.png'].map(name => 'docs/phase10/artifacts/reliability/' + name),
}
writeFileSync(resolve(root, 'docs/phase10/database-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log('Promoted complete local evidence without generated credentials from ' + directory)
