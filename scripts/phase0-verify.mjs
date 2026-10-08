import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'docs/phase0/logs')
mkdirSync(output, { recursive: true })
const resultsFile = resolve(root, 'docs/phase0/verification.json')
const testsOnly = process.argv.includes('--tests-only')
let results = testsOnly && existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : []
// Continue collecting baseline evidence even when existing quality gates fail.
// The overall command still exits nonzero; CI must never interpret this as an all-green release.
const commands = [
  'npm ci', 'npm run typecheck', 'npm run typecheck:tests', 'npm run lint', 'npm run build',
  'npm run test:unit', 'npm run test:integration', 'npm run test:tenant',
  'npm run test:ai-regression', 'npm run test:e2e', 'npm run test:all', 'npm run test:strict',
]
for (const command of commands.filter((command) => !testsOnly || command === 'npm run typecheck:tests' || command.startsWith('npm run test:'))) {
  const name = command.replaceAll(':', '-').replaceAll(' ', '-')
  const logFile = resolve(output, `final-${name}.log`)
  const descriptor = openSync(logFile, 'w')
  const started = Date.now()
  console.log(`Running ${command}`)
  const result = spawnSync(command, { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', descriptor, descriptor] })
  closeSync(descriptor)
  const entry = { command, exitCode: result.status, seconds: Math.round((Date.now() - started) / 100) / 10, log: `docs/phase0/logs/final-${name}.log` }
  if (command.startsWith('npm run test:') && command !== 'npm run test:e2e' && existsSync(resolve(root, 'test-results/vitest/baseline.json'))) {
    const tests = JSON.parse(readFileSync(resolve(root, 'test-results/vitest/baseline.json'), 'utf8'))
    entry.tests = { passed: tests.passed, expectedFailures: tests.expectedFailures, failed: tests.failed, moduleErrors: tests.moduleErrors }
    copyFileSync(resolve(root, 'test-results/vitest/baseline.json'), resolve(output, `${name}-results.json`))
  }
  if (['npm run test:e2e', 'npm run test:all'].includes(command) && existsSync(resolve(root, 'test-results/e2e.json'))) {
    const tests = JSON.parse(readFileSync(resolve(root, 'test-results/e2e.json'), 'utf8'))
    entry.e2e = tests.stats
    copyFileSync(resolve(root, 'test-results/e2e.json'), resolve(output, `${name}-e2e.json`))
  }
  results = results.filter((previous) => previous.command !== command)
  results.push(entry)
  writeFileSync(resultsFile, JSON.stringify(results, null, 2) + '\n')
  console.log(`${command}: exit ${result.status} (${entry.seconds}s)`)
}
process.exitCode = results.some((result) => result.exitCode !== 0) ? 1 : 0
