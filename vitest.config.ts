import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'tests/tenant-db/**'],
    setupFiles: ['tests/setup.ts'],
    reporters: ['./tests/support/baseline-reporter.ts'],
    testTimeout: 10000,
    restoreMocks: true,
  },
})
