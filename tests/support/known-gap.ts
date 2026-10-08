import { it } from 'vitest'

// Narrow expected-failure assertions: setup/observation failures are NOT swallowed.
// Unexpected improvements also fail, forcing removal of a resolved baseline gap.
export function knownGap(name: string, observe: () => unknown | Promise<unknown>,
  invariant: (result: any) => unknown | Promise<unknown>) {
  it(`[XFAIL] ${name}`, async (context) => {
    const result = await observe()
    try {
      await invariant(result)
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'AssertionError') throw error
      ;(context.task.meta as { knownFailure?: string }).knownFailure = error.message
      return
    }
    throw new Error(`Unexpected pass: ${name}. Remove the expected failure and add a normal regression test.`)
  })
}
