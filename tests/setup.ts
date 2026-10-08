import { afterEach, vi } from 'vitest'

// Tests must use explicit doubles. Any accidental network call fails the test.
vi.stubGlobal('fetch', vi.fn(() => {
  throw new Error('Unexpected network call in Phase 0 test; provide an explicit test double')
}))
afterEach(() => { vi.clearAllMocks() })
