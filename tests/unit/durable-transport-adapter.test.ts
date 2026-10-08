import {expect,it,vi} from 'vitest'
import {BaileysManager} from '../../backend/src/whatsapp/BaileysManager'
vi.mock('../../backend/src/config/supabase',()=>({getSupabaseAdmin:()=>({})}))
vi.mock('../../backend/src/modules/session/selfHealEngine',()=>({selfHealEngine:{registerDevice:vi.fn(),startHealthMonitor:vi.fn()}}))
vi.mock('../../backend/src/modules/ai/aiService',()=>({sanitize:(text:string)=>text}))
it('passes the persisted outbound ID to the actual Baileys socket adapter',async()=>{
 const manager=new BaileysManager({deviceId:'owned-device',orgId:'owned-org'})
 const sendMessage=vi.fn(async()=>({key:{id:'PERSISTED-OUTBOUND-ID'}}))
 const assertOwned=vi.fn(async()=>undefined)
 Object.assign(manager,{socket:{sendMessage},status:'open',lease:{isCurrent:()=>true,assertOwned}})
 expect(await manager.sendText('971500001111@s.whatsapp.net','Saved reply','PERSISTED-OUTBOUND-ID')).toEqual({messageId:'PERSISTED-OUTBOUND-ID'})
 expect(sendMessage).toHaveBeenCalledWith('971500001111@s.whatsapp.net',{text:'Saved reply'},{messageId:'PERSISTED-OUTBOUND-ID'})
 expect(assertOwned).toHaveBeenCalledOnce()
})
it('never calls the physical socket when ownership renewal fails',async()=>{
 const manager=new BaileysManager({deviceId:'owned-device',orgId:'owned-org'})
 const sendMessage=vi.fn(),assertOwned=vi.fn(async()=>{throw new Error('DEVICE_LEASE_LOST')})
 Object.assign(manager,{socket:{sendMessage},status:'open',lease:{isCurrent:()=>true,assertOwned}})
 await expect(manager.sendText('971500001111@s.whatsapp.net','Forbidden stale reply','STABLE-ID')).rejects.toThrow('DEVICE_LEASE_LOST')
 expect(sendMessage).not.toHaveBeenCalled()
})
it('rechecks local expiry after renewal before calling the socket',async()=>{
 const manager=new BaileysManager({deviceId:'owned-device',orgId:'owned-org'})
 const sendMessage=vi.fn(),isCurrent=vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
 Object.assign(manager,{socket:{sendMessage},status:'open',lease:{isCurrent,assertOwned:async()=>undefined}})
 await expect(manager.sendText('971500001111@s.whatsapp.net','Forbidden expired reply','STABLE-ID')).rejects.toThrow('DEVICE_LEASE_LOST')
 expect(sendMessage).not.toHaveBeenCalled()
})
