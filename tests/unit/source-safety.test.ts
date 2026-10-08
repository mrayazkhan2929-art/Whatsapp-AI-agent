import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const liveAllowed = new Set<string>([...JSON.parse(readFileSync('docs/live-validation/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/deployment/change-allowlist.json', 'utf8'))])
it('preserves the Phase 10 checkpoint outside the explicit Phase 11 allowlist',()=>{
 expect(createHash('sha256').update(readFileSync('docs/phase11/source-manifest.json')).digest('hex')).toBe('7541f3cb102ceb5b17408a7a7e10f99fb75f5d979a36d197b27759b727cb0487')
 const manifest=JSON.parse(readFileSync('docs/phase11/source-manifest.json','utf8')) as Record<string,string>
 const allowed=new Set<string>(JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8')))
 expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')!==hash).map(([file])=>file)).toEqual([])
})
it('preserves the Phase 7 checkpoint outside the explicit Phase 8 allowlist',()=>{
 expect(createHash('sha256').update(readFileSync('docs/phase8/source-manifest.json')).digest('hex')).toBe('e9d85f2ccbf965d43f7db226bab181a3df152990c5ff0cfc501b4cd6a66f3687')
 const manifest=JSON.parse(readFileSync('docs/phase8/source-manifest.json','utf8')) as Record<string,string>
 const allowed=new Set<string>([...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
 expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')!==hash).map(([file])=>file)).toEqual([])
})

it('preserves the Phase 0 checkpoint outside explicitly authorized phase paths', () => {
  expect(createHash('sha256').update(readFileSync('docs/phase0/source-manifest.json')).digest('hex')).toBe('26012520ea88c51de89b84bd2b27a3f82d92ad1b435fbc8c342b665dec4d5850')
  const manifest = JSON.parse(readFileSync('docs/phase0/source-manifest.json', 'utf8')) as Record<string, string>
  const allowed = new Set<string>([...JSON.parse(readFileSync('docs/phase1/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase2/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase3/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase4/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase5/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase6/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase7/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
  const changed = Object.entries(manifest).filter(([file, hash]) =>
    !allowed.has(file) && !liveAllowed.has(file) && createHash('sha256').update(readFileSync(file)).digest('hex') !== hash).map(([file]) => file)
  expect(changed).toEqual([])
})

it('preserves the Phase 1 source checkpoint outside the Phase 2 change allowlist', () => {
  expect(createHash('sha256').update(readFileSync('docs/phase2/source-manifest.json')).digest('hex')).toBe('458eb726c8722378e552073fe7d38e11cc2999a8d09f16ca557880b369aaf9af')
  const manifest = JSON.parse(readFileSync('docs/phase2/source-manifest.json', 'utf8')) as Record<string, string>
  const allowed = new Set<string>([...JSON.parse(readFileSync('docs/phase2/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase3/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase4/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase5/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase6/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase7/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
  expect(Object.entries(manifest).filter(([file, hash]) => !allowed.has(file) && !liveAllowed.has(file) && createHash('sha256').update(readFileSync(file)).digest('hex') !== hash).map(([file]) => file)).toEqual([])
})

it('preserves the Phase 2 checkpoint outside the explicit Phase 3 allowlist', () => {
  expect(createHash('sha256').update(readFileSync('docs/phase3/source-manifest.json')).digest('hex')).toBe('f9acce0af7f92c31034a6a3640a5e47bc831a1bc1551654bbfb1ae78b89fdf08')
  const manifest = JSON.parse(readFileSync('docs/phase3/source-manifest.json', 'utf8')) as Record<string, string>
  const allowed = new Set<string>([...JSON.parse(readFileSync('docs/phase3/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase4/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase5/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase6/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase7/change-allowlist.json', 'utf8')), ...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
  expect(Object.entries(manifest).filter(([file, hash]) => !allowed.has(file) && !liveAllowed.has(file) && createHash('sha256').update(readFileSync(file)).digest('hex') !== hash).map(([file]) => file)).toEqual([])
})

it('preserves the Phase 3 checkpoint outside the explicit Phase 4 allowlist', () => {
  expect(createHash('sha256').update(readFileSync('docs/phase4/source-manifest.json')).digest('hex')).toBe('17e5964cb4f566c80e0c3ce47d8cdf9606a29fe56541e1b857468619b4bddda1')
  const manifest=JSON.parse(readFileSync('docs/phase4/source-manifest.json','utf8')) as Record<string,string>
  const allowed=new Set<string>([...JSON.parse(readFileSync('docs/phase4/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase5/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase6/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase7/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
  expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')!==hash).map(([file])=>file)).toEqual([])
})

it('preserves the Phase 4 checkpoint outside the explicit Phase 5 allowlist',()=>{
 expect(createHash('sha256').update(readFileSync('docs/phase5/source-manifest.json')).digest('hex')).toBe('f16ecd9322fee30e83d3bd20b7e56d847f41def07f7209e3b368fe4cfcd82808')
 const manifest=JSON.parse(readFileSync('docs/phase5/source-manifest.json','utf8')) as Record<string,string>
 const allowed=new Set<string>([...JSON.parse(readFileSync('docs/phase5/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase6/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase7/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
 expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')!==hash).map(([file])=>file)).toEqual([])
})

it('preserves the Phase 5 checkpoint outside the explicit Phase 6 allowlist',()=>{
 expect(createHash('sha256').update(readFileSync('docs/phase6/source-manifest.json')).digest('hex')).toBe('1baa8d90c1b607773738589896318167013b77fcbb47188c0f9581578c5f7cb8')
 const manifest=JSON.parse(readFileSync('docs/phase6/source-manifest.json','utf8')) as Record<string,string>
 const allowed=new Set<string>([...JSON.parse(readFileSync('docs/phase6/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase7/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
 expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')!==hash).map(([file])=>file)).toEqual([])
})

it('preserves the Phase 6 checkpoint outside the explicit Phase 7 allowlist',()=>{
 expect(createHash('sha256').update(readFileSync('docs/phase7/source-manifest.json')).digest('hex')).toBe('5c2dc432da5d602c1c30e32c9ae2daa927b1f2d826419a051327d55af4e73c39')
 const manifest=JSON.parse(readFileSync('docs/phase7/source-manifest.json','utf8')) as Record<string,string>
 const allowed=new Set<string>([...JSON.parse(readFileSync('docs/phase7/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase8/change-allowlist.json','utf8')), ...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
 expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')!==hash).map(([file])=>file)).toEqual([])
})

it('preserves the Phase 8 checkpoint outside the explicit Phase 9 allowlist',()=>{
 expect(createHash('sha256').update(readFileSync('docs/phase9/source-manifest.json')).digest('hex')).toBe('f650c6bb8d5e23d5be147affca816ea2fa9aaa9352027c6580fb2ccaba4d59c4')
 const manifest=JSON.parse(readFileSync('docs/phase9/source-manifest.json','utf8')) as Record<string,string>
 const allowed=new Set<string>([...JSON.parse(readFileSync('docs/phase9/change-allowlist.json','utf8')),...[...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))]])
 expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase()!==hash.toUpperCase()).map(([file])=>file)).toEqual([])
})

it('preserves the Phase 9 checkpoint outside the explicit Phase 10 allowlist',()=>{
 expect(createHash('sha256').update(readFileSync('docs/phase10/source-manifest.json')).digest('hex')).toBe('0f664677da1d62e165f73ffdfcb43068e8dfb13cdc1267ffd1090f1ab45d105f')
 const manifest=JSON.parse(readFileSync('docs/phase10/source-manifest.json','utf8')) as Record<string,string>
 const allowed=new Set<string>([...JSON.parse(readFileSync('docs/phase10/change-allowlist.json','utf8')),...JSON.parse(readFileSync('docs/phase11/change-allowlist.json','utf8'))])
 expect(Object.entries(manifest).filter(([file,hash])=>!allowed.has(file) && !liveAllowed.has(file)&&createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase()!==hash.toUpperCase()).map(([file])=>file)).toEqual([])
})

