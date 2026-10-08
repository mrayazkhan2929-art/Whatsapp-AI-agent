import { mkdirSync, writeFileSync } from 'node:fs'
import type { Reporter, TestCase, TestModule } from 'vitest/node'
import type { SerializedError } from 'vitest'

export default class BaselineReporter implements Reporter {
  private cases: Array<{ name: string; outcome: string; error?: string; expectedFailure?: string }> = []
  onTestCaseResult(test: TestCase) {
    const result = test.result()
    const expectedFailure = (test.meta() as { knownFailure?: string }).knownFailure
    const expected = test.name.startsWith('[XFAIL]') && Boolean(expectedFailure)
    const outcome = result.state === 'passed' ? (expected ? 'XFAIL' : 'PASS') : result.state.toUpperCase()
    const error = result.errors?.map((e) => e.message).join('\n')
    this.cases.push({ name: test.fullName, outcome, ...(error ? { error } : {}), ...(expectedFailure ? { expectedFailure } : {}) })
    console.log(`${outcome} ${test.fullName}${error ? `\n${error}` : ''}`)
  }
  onTestRunEnd(modules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>) {
    const moduleErrors = [...modules.flatMap((module) => module.errors()), ...unhandledErrors].map((e) => e.message)
    const passed = this.cases.filter((t) => t.outcome === 'PASS').length
    const expectedFailures = this.cases.filter((t) => t.outcome === 'XFAIL').length
    const failed = this.cases.filter((t) => t.outcome === 'FAILED').length
    const report = { passed, expectedFailures, failed, moduleErrors, cases: this.cases }
    mkdirSync('test-results/vitest', { recursive: true })
    writeFileSync('test-results/vitest/baseline.json', JSON.stringify(report, null, 2) + '\n')
    moduleErrors.forEach((message) => console.error(`MODULE ERROR ${message}`))
    console.log(`BASELINE: ${passed} PASS, ${expectedFailures} XFAIL (known defects; NOT passing behavior), ${failed} FAIL, ${moduleErrors.length} module errors`)
  }
}
