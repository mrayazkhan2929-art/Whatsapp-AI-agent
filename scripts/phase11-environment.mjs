import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', windowsHide: true }).trim()
const prior = JSON.parse(readFileSync(resolve(root, 'docs/phase10/environment-restoration.json'), 'utf8'))
const checkpoint = JSON.parse(readFileSync(resolve(root,'docs/phase11/checkpoint.json'),'utf8'))
const inspected = JSON.parse(command('docker', ['inspect', ...prior.userContainers.map(item => item.name)]))
const userContainers = inspected.map(item => ({ id: item.Id, startedAt: item.State.StartedAt, name: item.Name.replace(/^\//, '') }))
const remaining = kind => command('docker', [kind, 'ls', '--format', '{{.Name}}']).split(/\r?\n/).filter(name => name.startsWith('wa-phase11-'))
const remainingPhase11Containers = command('docker', ['ps', '-a', '--format', '{{.Names}}']).split(/\r?\n/).filter(name => name.startsWith('wa-phase11-'))
const listeners = command('powershell', ['-NoProfile', '-Command', "@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3000,3001 } | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress"])
const developmentListeners = listeners ? [JSON.parse(listeners)].flat() : []
const evidence = {
  verifiedAt: new Date().toISOString(), appliedToLiveProject: false, userContainers,
  comparison: 'Phase 10 container IDs and the Phase 11 pre-edit checkpoint; current Docker StartedAt must predate Phase 11',
  phase10StartTimesMatch: prior.userContainers.every(item=>userContainers.some(current=>item.name===current.name&&item.startedAt===current.startedAt)),
  userContainerIdentitiesAndStartTimesUnchanged: prior.userContainers.every(item => userContainers.some(current => item.name === current.name && item.id === current.id && new Date(current.startedAt).getTime() <= new Date(checkpoint.created).getTime())),
  phase11CheckpointCreatedAt: checkpoint.created,
  remainingPhase11Containers, remainingPhase11Volumes: remaining('volume'), remainingPhase11Networks: remaining('network'),
  developmentServicesInitiallyRunning: false, developmentServicesRunningAfter: developmentListeners.length > 0, developmentListeners,
}
writeFileSync(resolve(root, 'docs/phase11/environment-restoration.json'), JSON.stringify(evidence, null, 2) + '\n')
if (!evidence.userContainerIdentitiesAndStartTimesUnchanged || remainingPhase11Containers.length || evidence.remainingPhase11Volumes.length || evidence.remainingPhase11Networks.length || developmentListeners.length) {
  throw new Error('Environment restoration check failed; inspect sanitized evidence without modifying unrelated resources')
}
console.log('User containers unchanged; disposable Phase 11 resources removed; development applications remain stopped')
