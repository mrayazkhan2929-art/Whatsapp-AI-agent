import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/tenant-db/**/*.test.ts'], reporters: ['verbose', ['json', { outputFile: 'test-results/phase5-tenant-db.json' }]], testTimeout: 60000, hookTimeout: 120000, fileParallelism: false },
})
