import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', windowsHide: true }).trim()
const prior = JSON.parse(readFileSync(resolve(root, 'docs/phase9/environment-restoration.json'), 'utf8'))
const inspected = JSON.parse(command('docker', ['inspect', ...prior.userContainers.map(item => item.name)]))
const userContainers = inspected.map(item => ({ id: item.Id, startedAt: item.State.StartedAt, name: item.Name.replace(/^\//, '') }))
const remaining = kind => command('docker', [kind, 'ls', '--format', '{{.Name}}']).split(/\r?\n/).filter(name => name.startsWith('wa-phase10-'))
const remainingPhase10Containers = command('docker', ['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).filter(name => name.startsWith('wa-phase10-'))
const listeners = command('powershell', ['-NoProfile', '-Command', "@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3000,3001 } | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress"])
const developmentListeners = listeners ? [JSON.parse(listeners)].flat() : []
const evidence = {
  verifiedAt: new Date().toISOString(), appliedToLiveProject: false, userContainers,
  userContainerIdentitiesAndStartTimesUnchanged: prior.userContainers.every(item => userContainers.some(current => item.name === current.name && item.id === current.id && item.startedAt === current.startedAt)),
  remainingPhase10Containers, remainingPhase10Volumes: remaining('volume'), remainingPhase10Networks: remaining('network'),
  developmentServicesInitiallyRunning: false, developmentServicesRunningAfter: developmentListeners.length > 0, developmentListeners,
}
writeFileSync(resolve(root, 'docs/phase10/environment-restoration.json'), JSON.stringify(evidence, null, 2) + '\n')
if (!evidence.userContainerIdentitiesAndStartTimesUnchanged || remainingPhase10Containers.length || evidence.remainingPhase10Volumes.length || evidence.remainingPhase10Networks.length || developmentListeners.length) {
  throw new Error('Environment restoration check failed; inspect sanitized evidence without modifying unrelated resources')
}
console.log('User containers unchanged; disposable Phase 10 resources removed; development applications remain stopped')
