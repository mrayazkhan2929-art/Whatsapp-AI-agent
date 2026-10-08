import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync,statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root,'docs/phase7/logs')
mkdirSync(output,{ recursive:true })
const databaseOnly=process.argv.includes('--database-only')
const results = databaseOnly ? JSON.parse(readFileSync(resolve(root,'docs/phase7/verification.json'),'utf8')).filter(entry=>entry.command!=='npm run test:knowledge:db') : []
const commands = databaseOnly ? ['npm run test:knowledge:db'] : [
  'npm ci', 'npm run typecheck', 'npm run typecheck:tests', 'npm run lint', 'npm run build',
  'npm run test:unit', 'npm run test:integration', 'npm run test:tenant', 'npm run test:tenant:strict',
  'npm run test:ai-regression', 'npm run test:e2e', 'npm run test:all', 'npm run test:strict', 'npm run test:knowledge:db',
]
for (const command of commands) {
  const name = command.replaceAll(':','-').replaceAll(' ','-')
  const log = `docs/phase7/logs/${name}.log`
  const descriptor = openSync(resolve(root,log),'w')
  const started = Date.now()
  const fresh=file=>existsSync(resolve(root,file))&&statSync(resolve(root,file)).mtimeMs>=started
  console.log('Running '+command)
  const result = spawnSync(command,{ cwd:root,shell:true,windowsHide:true,stdio:['ignore',descriptor,descriptor] })
  closeSync(descriptor)
  const entry = { command, exitCode:result.status, seconds:Math.round((Date.now()-started)/100)/10, log }
  if (command.startsWith('npm run test:') && !['npm run test:e2e','npm run test:knowledge:db'].includes(command) && fresh('test-results/vitest/baseline.json')) {
    const tests = JSON.parse(readFileSync(resolve(root,'test-results/vitest/baseline.json'),'utf8'))
    entry.tests = { passed:tests.passed,expectedFailures:tests.expectedFailures,failed:tests.failed,moduleErrors:tests.moduleErrors }
    copyFileSync(resolve(root,'test-results/vitest/baseline.json'),resolve(output,`${name}-results.json`))
  }
  if (['npm run test:e2e','npm run test:all'].includes(command) && fresh('test-results/e2e.json')) {
    entry.e2e = JSON.parse(readFileSync(resolve(root,'test-results/e2e.json'),'utf8')).stats
    copyFileSync(resolve(root,'test-results/e2e.json'),resolve(output,`${name}-e2e.json`))
  }
  if (command === 'npm run test:knowledge:db' && fresh('test-results/phase7-tenant-db.json')) {
    const tests = JSON.parse(readFileSync(resolve(root,'test-results/phase7-tenant-db.json'),'utf8'))
    entry.tests = { passed:tests.numPassedTests,failed:tests.numFailedTests,total:tests.numTotalTests }
    copyFileSync(resolve(root,'test-results/phase7-tenant-db.json'),resolve(output,`${name}-results.json`))
  }
  results.push(entry)
  writeFileSync(resolve(root,'docs/phase7/verification.json'),JSON.stringify(results,null,2)+'\n')
  console.log(`${command}: exit ${entry.exitCode} (${entry.seconds}s)`)
  if(command==='npm ci' && result.status!==0)break
}
// Preserve inherited failures visibly; collecting evidence never implies all gates passed.
process.exitCode = (databaseOnly ? results.filter(entry=>entry.command==='npm run test:knowledge:db') : results).some(entry => entry.exitCode !== 0) ? 1 : 0
