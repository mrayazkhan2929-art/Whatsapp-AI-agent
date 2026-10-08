import {afterEach,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {DeviceLeaseService} from '../../backend/src/whatsapp/DeviceLeaseService'
import {processMessageJob} from '../../backend/src/queue/workers/MessageWorker'

const org=randomUUID(),device=randomUUID(),request=randomUUID()
const handles:DeviceLeaseService[]=[]
function setup(responses:Array<{data?:unknown;error?:unknown}|Error>){
 const rpc=vi.fn((_name:string,_params:unknown)=>{const response=responses.shift()??{data:{generation:3}};return{abortSignal:()=>response instanceof Error?Promise.reject(response):Promise.resolve(response)}})
 const lost=vi.fn(),lease=new DeviceLeaseService(device,org,lost,{rpc} as any,2)
 handles.push(lease);return{lease,lost,rpc}
}
afterEach(()=>{for(const lease of handles.splice(0))lease.invalidate()})
describe('device lease lifecycle',()=>{
 it('acquires only the server generation and renews with its fence',async()=>{
  const {lease,rpc}=setup([{data:{generation:3}},{data:{generation:3}}]);await lease.acquire();await lease.assertOwned()
  expect(lease.isCurrent()).toBe(true);expect(rpc.mock.calls[1]).toEqual(['device_runtime_lease',expect.objectContaining({p_org:org,p_device:device,p_generation:3,p_owner:lease.ownerId,p_action:'renew'})])
 })
 it('refuses an active competing owner',async()=>{const {lease}=setup([{data:null}]);await expect(lease.acquire()).rejects.toMatchObject({code:'DEVICE_LEASE_HELD'});expect(lease.isCurrent()).toBe(false)})
 it('preserves infrastructure failure as unavailable',async()=>{const {lease}=setup([{error:{code:'08006'}}]);await expect(lease.acquire()).rejects.toMatchObject({code:'DEVICE_LEASE_UNAVAILABLE'})})
 it('permanently fences a generation mismatch',async()=>{const {lease,lost,rpc}=setup([{data:{generation:3}},{data:{generation:4}}]);await lease.acquire();await expect(lease.assertOwned()).rejects.toMatchObject({code:'DEVICE_LEASE_LOST'});await expect(lease.acquire()).rejects.toMatchObject({code:'DEVICE_LEASE_LOST'});expect(lost).toHaveBeenCalledOnce();expect(rpc).toHaveBeenCalledTimes(2)})
 it('closes on database loss without continuing locally',async()=>{const {lease,lost}=setup([{data:{generation:3}},new Error('offline')]);await lease.acquire();await expect(lease.assertOwned()).rejects.toMatchObject({code:'DEVICE_LEASE_LOST'});expect(lost).toHaveBeenCalledOnce()})
 it('rejects unsafe generations',async()=>{const {lease,lost}=setup([{data:{generation:'9007199254740992'}}]);await expect(lease.acquire()).rejects.toMatchObject({code:'DEVICE_LEASE_LOST'});expect(lost).toHaveBeenCalledOnce()})
 it('releases the captured generation and invalidates immediately',async()=>{const {lease,lost,rpc}=setup([{data:{generation:3}},{data:{generation:4}}]);await lease.acquire();await lease.release();expect(lease.isCurrent()).toBe(false);expect(lost).toHaveBeenCalledOnce();expect(rpc.mock.calls[1][1]).toMatchObject({p_generation:3,p_action:'release'})})
 it('never renews after explicit invalidation',async()=>{const {lease,rpc}=setup([{data:{generation:3}}]);await lease.acquire();lease.invalidate();await expect(lease.assertOwned()).rejects.toMatchObject({code:'DEVICE_LEASE_LOST'});expect(rpc).toHaveBeenCalledOnce()})
 it('shares concurrent renewal and rechecks ownership afterwards',async()=>{const {lease,rpc}=setup([{data:{generation:3}},{data:{generation:3}}]);await lease.acquire();await Promise.all([lease.assertOwned(),lease.assertOwned()]);expect(rpc).toHaveBeenCalledTimes(2)})
 it('a repeated acquisition renews the same handle instead of creating another heartbeat',async()=>{const {lease,rpc}=setup([{data:{generation:3}},{data:{generation:3}}]);await lease.acquire();await lease.acquire();expect(rpc.mock.calls.map(call=>(call[1] as any).p_action)).toEqual(['acquire','renew'])})
})
function worker(claim:unknown,receipt:string|null=request){
 const rpc=vi.fn(async(name:string,_params:unknown)=>({data:name==='claim_device_send'?claim:null,error:null})),send=vi.fn(async()=>({messageId:receipt}))
 const lease={orgId:org,deviceId:device,fence:{ownerId:randomUUID(),generation:3},assertOwned:vi.fn(async()=>undefined)}
 return{context:{db:{rpc} as any,lease:lease as any,send},rpc,send,lease}
}
describe('durable owner worker admission',()=>{
 const data={orgId:org,deviceId:device,requestId:request},claim={wa_message_id:request,jid:'971500001111@s.whatsapp.net',content:'Prepared reply'}
 it('rejects payload content before touching storage',async()=>{const w=worker(claim);await expect(processMessageJob({data:{...data,text:'forged'} as any},w.context)).rejects.toThrow();expect(w.rpc).not.toHaveBeenCalled()})
 it('rejects another tenant before touching storage',async()=>{const w=worker(claim);await expect(processMessageJob({data:{...data,orgId:randomUUID()}},w.context)).rejects.toThrow('JOB_SCOPE_MISMATCH');expect(w.send).not.toHaveBeenCalled();expect(w.rpc).not.toHaveBeenCalled()})
 it('ignores an already claimed request without sending',async()=>{const w=worker(null);await processMessageJob({data},w.context);expect(w.send).not.toHaveBeenCalled();expect(w.rpc).toHaveBeenCalledOnce()})
  it('records only a matching stable receipt as sent',async()=>{const w=worker(claim);await processMessageJob({data},w.context);expect(w.send).toHaveBeenCalledWith({orgId:org,deviceId:device,jid:claim.jid,text:claim.content,messageId:request});expect(w.rpc.mock.calls[1][1]).toMatchObject({p_success:true,p_receipt:request})})
 it('quarantines an ambiguous transport result without retry',async()=>{const w=worker(claim,null);await processMessageJob({data},w.context);expect(w.rpc.mock.calls[1][1]).toMatchObject({p_success:false});expect(w.send).toHaveBeenCalledOnce()})
 it('fences lease loss between claim and send',async()=>{const w=worker(claim);w.lease.assertOwned.mockRejectedValueOnce(new Error('lease lost'));await expect(processMessageJob({data},w.context)).rejects.toThrow('lease lost');expect(w.send).not.toHaveBeenCalled();expect(w.rpc).not.toHaveBeenCalled()})
})
