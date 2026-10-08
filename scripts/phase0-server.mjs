import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2]
if (!['frontend', 'backend'].includes(mode)) throw new Error('Expected frontend or backend')
const envFiles = ['.env', '.env.local', 'backend/.env', 'backend/.env.local', 'frontend/.env.local', 'frontend/.env.production', 'frontend/.env.production.local']
if (envFiles.some((file) => existsSync(resolve(root, file)))) {
  throw new Error('E2E launcher requires a disposable checkout without real .env files; refusing to boot with live credentials')
}
const environment = { ...process.env }
const inventory = JSON.parse(readFileSync(resolve(root, 'docs/phase0/inventory.json'), 'utf8'))
for (const { name } of inventory.environment) delete environment[name]
Object.assign(environment, { NODE_ENV: 'production', PORT: mode === 'backend' ? '3101' : '3100', TZ: 'Asia/Dubai', NEXT_TELEMETRY_DISABLED: '1' })
const entry = mode === 'backend' ? resolve(root, 'backend/dist/index.js') : resolve(root, 'node_modules/next/dist/bin/next')
const args = mode === 'backend' ? [entry] : [entry, 'start', '-p', '3100', '-H', '127.0.0.1']
const child = spawn(process.execPath, args, { cwd: mode === 'backend' ? root : resolve(root, 'frontend'), env: environment, stdio: 'inherit', windowsHide: true })
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal) })
