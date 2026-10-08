import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./frontend/src',import.meta.url))}},test:{environment:'node',include:['tests/tenant-db/**/*.test.ts'],reporters:['verbose',['json',{outputFile:'test-results/phase11-tenant-db.json'}]],testTimeout:60000,hookTimeout:process.env.PHASE11_MANUAL_REVIEW==='1'?43200000:120000,fileParallelism:false}})
