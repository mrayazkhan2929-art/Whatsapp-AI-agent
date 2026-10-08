import { describe,expect,it,vi } from 'vitest'
import { createRequire } from 'node:module'
import { safeRedirect } from '../../frontend/src/lib/safe-redirect'
import { requireOrgScope } from '../../backend/src/api/middleware/orgScope'

describe('same-origin login destinations',()=>{
  it.each(['//evil.invalid','/\\evil.invalid','/login?redirect=/inbox','/\n/evil.invalid','https://evil.invalid',''])('rejects %j',input=>expect(safeRedirect(input)).toBe('/dashboard'))
  it('keeps a local path and encoded query',()=>expect(safeRedirect('/contacts?search=Marina%20Bay#details')).toBe('/contacts?search=Marina%20Bay#details'))
})
describe('server-side mutation permissions',()=>{
  it.each(['viewer','operator','member'])('protects configuration from %s',role=>{
    const response={status:vi.fn().mockReturnThis(),json:vi.fn()},next=vi.fn()
    requireOrgScope({method:'POST',originalUrl:'/api/v1/devices',auth:{orgId:'own',role}} as any,response as any,next)
    expect(response.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled()
  })
  it('permits operator replies and administrator configuration',()=>{
    for(const [role,path]of [['operator','/api/v1/messages'],['admin','/api/v1/devices']]){
      const next=vi.fn();requireOrgScope({method:'POST',originalUrl:path,auth:{orgId:'own',role}} as any,{} as any,next);expect(next).toHaveBeenCalledOnce()
    }
  })
})
it('patched protobuf preserves the actual Signal prekey and ratchet roundtrip',async()=>{
  const signal=createRequire(import.meta.url)('libsignal')
  const identityA=signal.curve.generateKeyPair(),identityB=signal.curve.generateKeyPair(),signed=signal.curve.generateKeyPair(),prekey=signal.curve.generateKeyPair()
  function store(identity:any,registration:number){
    const sessions=new Map()
    return{getOurIdentity:async()=>identity,getOurRegistrationId:async()=>registration,isTrustedIdentity:async()=>true,loadSession:async(id:string)=>sessions.get(id),storeSession:async(id:string,record:any)=>sessions.set(id,signal.SessionRecord.deserialize(record.serialize())),loadPreKey:async()=>prekey,loadSignedPreKey:async()=>signed,removePreKey:async()=>{}}
  }
  const a=store(identityA,101),b=store(identityB,202),addressA=new signal.ProtocolAddress('phase11-a',1),addressB=new signal.ProtocolAddress('phase11-b',1)
  await new signal.SessionBuilder(a,addressB).initOutgoing({registrationId:202,identityKey:identityB.pubKey,signedPreKey:{keyId:1,publicKey:signed.pubKey,signature:signal.curve.calculateSignature(identityB.privKey,signed.pubKey)},preKey:{keyId:2,publicKey:prekey.pubKey}})
  const sender=new signal.SessionCipher(a,addressB),recipient=new signal.SessionCipher(b,addressA)
  const first=await sender.encrypt(Buffer.from('Verified local roundtrip مرحبا'))
  expect((await recipient.decryptPreKeyWhisperMessage(first.body)).toString()).toBe('Verified local roundtrip مرحبا')
  const reply=await recipient.encrypt(Buffer.from('Confirmed reply'))
  expect((await sender.decryptWhisperMessage(reply.body)).toString()).toBe('Confirmed reply')
})
