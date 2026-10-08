import { readFileSync } from 'node:fs'
const result = JSON.parse(readFileSync('test-results/vitest/baseline.json', 'utf8'))
if (result.expectedFailures || result.failed || result.moduleErrors.length) {
  console.error(`STRICT GATE FAILED: ${result.expectedFailures} known defects; ${result.failed} unexpected failures; ${result.moduleErrors.length} module errors.`)
  process.exitCode = 1
} else console.log('Strict gate passed')
