import { expect,it,vi } from 'vitest'
import {NextRequest} from 'next/server'
import {isSameOrigin} from '../../frontend/src/lib/request-origin'
import {apiRateLimit} from '../../backend/src/api/middleware/rateLimit'
it('permits browser authority normalization and rejects forged origins',()=>{
 const request=(origin:string,host='127.0.0.1:3000')=>new NextRequest('http://localhost:3000/api/settings',{headers:{origin,host,'x-forwarded-host':'evil.invalid'}})
 expect(isSameOrigin(request('http://127.0.0.1:3000'))).toBe(true)
 for(const origin of ['https://evil.invalid','http://127.0.0.1:3001','https://127.0.0.1:3000','not a URL'])expect(isSameOrigin(request(origin))).toBe(false)
})
it('bounds per-client bursts, returns retry timing, and recovers after expiry',()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(100000)
 const next=vi.fn(),response={status:vi.fn().mockReturnThis(),json:vi.fn(),setHeader:vi.fn()},request={ip:'rate-fixture',baseUrl:'/test'}
 for(let n=0;n<121;n++)apiRateLimit(request as any,response as any,next)
 expect(next).toHaveBeenCalledTimes(120);expect(response.status).toHaveBeenCalledWith(429);expect(response.setHeader).toHaveBeenCalledWith('Retry-After','60')
 clock.mockReturnValue(160001);apiRateLimit(request as any,response as any,next);expect(next).toHaveBeenCalledTimes(121)
})
it('limits unique counter admission and reclaims expired entries',()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(500000),next=vi.fn(),response={status:vi.fn().mockReturnThis(),json:vi.fn(),setHeader:vi.fn()}
 for(let n=0;n<10001;n++)apiRateLimit({ip:'bounded-'+n,baseUrl:'/bounded'} as any,response as any,next)
 expect(next).toHaveBeenCalledTimes(10000);expect(response.status).toHaveBeenCalledWith(429)
 clock.mockReturnValue(560001);apiRateLimit({ip:'new-after-expiry',baseUrl:'/bounded'} as any,response as any,next);expect(next).toHaveBeenCalledTimes(10001)
})
import {POST as register} from '../../frontend/src/app/api/auth/register/route'
import {POST as login} from '../../frontend/src/app/api/auth/login/route'
it.each([null,[], 'unstructured'])('malformed registration body %j is rejected without cookies',async body=>{
 for(const handler of [register,login]){
 const response=await handler(new NextRequest('http://localhost/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))
 expect(response.status).toBe(400);expect(response.headers.has('set-cookie')).toBe(false)
 }
})

it('invalid JSON is rejected before authentication without cookies or error logging',async()=>{
 const logging=vi.spyOn(console,'error')
 for(const handler of [register,login]){const response=await handler(new NextRequest('http://localhost/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:'{'}));expect(response.status).toBe(400);expect(response.headers.has('set-cookie')).toBe(false)}
 expect(logging).not.toHaveBeenCalled()
})
