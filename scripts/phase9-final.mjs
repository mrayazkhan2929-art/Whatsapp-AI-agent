import { spawnSync } from 'node:child_process'
import { openSync, closeSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const full = read('docs/phase9/verification.json')
if (full.length !== 14 || full.some(item => item.command !== 'npm run lint' && item.exitCode !== 0)) throw new Error('Require complete final verification before final evidence checks')
const results = []
for (const [command, log, allowedExit] of [
  ['npm run lint', 'docs/phase9/logs/final-lint.log', 1],
  ['node scripts/phase9-evidence.mjs', 'docs/phase9/logs/final-evidence.log', 0],
  ['node scripts/phase9-environment.mjs', 'docs/phase9/logs/final-environment.log', 0],
  ['node node_modules/vitest/vitest.mjs run tests/unit/source-safety.test.ts', 'docs/phase9/logs/final-preservation.log', 0],
  ['node scripts/phase9-files.mjs', 'docs/phase9/logs/final-files.log', 0],
]) {
  const descriptor = openSync(resolve(root, log), 'w'), started = Date.now()
  const process = spawnSync(command, { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', descriptor, descriptor] })
  closeSync(descriptor)
  const entry = { command, exitCode: process.status, seconds: Math.round((Date.now() - started) / 100) / 10, log }
  if (command.startsWith('node node_modules/vitest')) {
    const tests = read('test-results/vitest/baseline.json')
    entry.tests = { passed: tests.passed, expectedFailures: tests.expectedFailures, failed: tests.failed, moduleErrors: tests.moduleErrors }
  }
  results.push(entry)
  writeFileSync(resolve(root, 'docs/phase9/final-verification.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(command + ': exit ' + process.status)
  if (process.status !== allowedExit) throw new Error('Unexpected final gate result: ' + command)
  if (command === 'npm run lint') {
    const text = readFileSync(resolve(root, log), 'utf8')
    if (!text.includes('4 problems (3 errors, 1 warning)') || !['EmbeddedSaaSFrame.tsx', 'ConversationList.tsx', 'MessageInput.tsx', 'LoginPage.tsx'].every(name => text.includes(name))) throw new Error('Lint findings differ from inherited diagnostics')
  }
}
const preservation = results.find(item => item.command.startsWith('node node_modules/vitest'))
if (preservation.tests.passed !== 9 || preservation.tests.failed || preservation.tests.expectedFailures || preservation.tests.moduleErrors.length) throw new Error('Preservation gate incomplete')
console.log('Final evidence checks passed; inherited lint exception remains explicit')
