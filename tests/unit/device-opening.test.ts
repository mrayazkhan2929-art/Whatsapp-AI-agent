import {EventEmitter} from 'node:events'
import {expect,it,vi} from 'vitest'
import {BaileysManager} from '../../backend/src/whatsapp/BaileysManager'
const storage=vi.hoisted(()=>({rpc:vi.fn((name:string)=>{
 const result=new Promise(resolve=>setTimeout(()=>resolve({data:name==='device_runtime_lease'?{generation:1}:null,error:null}),5))
 return Object.assign(result,{abortSignal:()=>result})
})}))
vi.mock('../../backend/src/config/supabase',()=>({getSupabaseAdmin:()=>storage}))
vi.mock('../../backend/src/whatsapp/DBAuthState',()=>({DBAuthState:class{},useDBAuthState:async()=>({state:{creds:{},keys:{get:async()=>({}),set:async()=>undefined}},saveCreds:async()=>undefined})}))
vi.mock('../../backend/src/modules/session/selfHealEngine',()=>({selfHealEngine:{registerDevice:vi.fn(),unregisterDevice:vi.fn(),startHealthMonitor:vi.fn(),onConnect:vi.fn()}}))
vi.mock('../../backend/src/modules/ai/aiService',()=>({sanitize:(text:string)=>text}))
it('retains an open event that arrives during the post-creation lease renewal',async()=>{
 const end=vi.fn(),ev=new EventEmitter()
 const manager=new BaileysManager({deviceId:'local-device',orgId:'local-org'},{latestVersion:async()=>({version:[2,3000,0],isLatest:true}) as any,makeSocket:(()=>{
  queueMicrotask(()=>ev.emit('connection.update',{connection:'open'}))
  return{ev,end,ws:{readyState:1},user:{id:'971500001111:1@s.whatsapp.net'}}
 }) as any})
 try{await manager.connect();await manager.waitForConnection(1000);expect(manager.isConnected()).toBe(true);expect(end).not.toHaveBeenCalled()}
 finally{await manager.pause()}
})
