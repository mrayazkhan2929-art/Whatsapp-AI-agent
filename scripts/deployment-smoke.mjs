// Authenticated HTTPS acceptance probe with a uniquely owned, disposable tenant.
// No WhatsApp messages are sent and no phone is paired. Cleanup targets only this probe.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'test-results/deployment')
const config=JSON.parse(readFileSync(resolve(out,'credentials.json'),'utf8'))
const admin=createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const base='https://frontend-production-3cb5.up.railway.app', marker=randomUUID()
const identity={email:'deployment-smoke-'+marker+'@example.invalid',password:randomBytes(24).toString('base64url')}
const company='Disposable deployment probe '+marker
const evidence={at:new Date().toISOString(),checks:[],realQR:false,whatsappMessagesSent:0,cleanup:false}
let userId,orgId,deviceId,headers
const assert=(name,value)=>{evidence.checks.push({name,passed:Boolean(value)});writeFileSync(resolve(out,'smoke-progress.json'),JSON.stringify(evidence,null,2)+'\n');if(!value)throw Error('Failed: '+name)}
const call=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:headers??{origin:base,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const payload=await response.json().catch(()=>null);return {response,payload}}
try{
 const created=await admin.auth.admin.createUser({...identity,email_confirm:true,user_metadata:{name:'Disposable deployment probe'}})
 assert('Controlled test identity created',!created.error&&Boolean(created.data.user?.id));userId=created.data.user.id
 const onboard=await call('/api/auth/register','POST',{...identity,name:'Deployment probe',companyName:company,action:'onboard'})
 assert('HTTPS onboarding through both applications',onboard.response.status===201)
 orgId=onboard.payload.data.orgId
 const cookies=onboard.response.headers.getSetCookie()
 assert('Authenticated cookies are Secure and HttpOnly',cookies.length>=2&&cookies.every(cookie=>/Secure/i.test(cookie)&&/HttpOnly/i.test(cookie)))
 headers={cookie:cookies.map(cookie=>cookie.split(';')[0]).join('; '),origin:base,'content-type':'application/json'}
 const me=await call('/api/auth/me');assert('Canonical tenant membership',me.response.status===200&&me.payload.data.orgId===orgId&&me.payload.data.userId===userId)
 for(const path of ['/api/agents','/api/devices','/api/properties','/api/contacts','/api/conversations','/api/knowledge-bases','/api/team','/api/settings','/api/settings/company-profile','/api/auth/onboarding']){const result=await call(path);assert('Authenticated GET '+path,result.response.status===200)}
 const bad=await fetch(base+'/api/auth/me',{headers:{authorization:'Bearer forged-deployment-token'}});assert('Forged identity rejected through private backend',bad.status===401)
 const foreignOrigin=await fetch(base+'/api/devices',{method:'POST',headers:{...headers,origin:'https://foreign.example'},body:JSON.stringify({name:'blocked'})});assert('Foreign Origin rejected',foreignOrigin.status===403)
 const device=await call('/api/devices','POST',{name:'Unpaired deployment QR probe',org_id:randomUUID()});assert('Device created with forged org ignored',device.response.status===201);deviceId=device.payload.data.id
 const stored=await admin.from('devices').select('org_id').eq('id',deviceId).single();assert('Server organization owns the device',stored.data?.org_id===orgId)
 const connected=await call('/api/devices/'+deviceId+'/connect','POST',{});assert('Real hosted WhatsApp connection started',connected.response.ok)
 for(let attempt=0;attempt<45;attempt++){const result=await call('/api/devices/'+deviceId+'/qr');const data=result.payload?.data??result.payload;if(typeof data?.qrImage==='string'&&data.qrImage.startsWith('data:image/png;base64,')){evidence.realQR=true;break}await new Promise(r=>setTimeout(r,1000))}
 assert('Real WhatsApp QR returned from Railway through HTTPS',evidence.realQR)
}catch(error){evidence.error=error.message;process.exitCode=1}
finally{
 if(deviceId&&headers){const disconnected=await call('/api/devices/'+deviceId+'/disconnect','POST',{});assert('Unpaired probe disconnected',disconnected.response.ok);const deleted=await call('/api/devices/'+deviceId,'DELETE');assert('Own probe device removed',deleted.response.ok)}
 if(!orgId&&userId){const membership=await admin.from('users').select('org_id').eq('id',userId).maybeSingle();orgId=membership.data?.org_id}
 if(orgId){const organization=await admin.from('organizations').select('name').eq('id',orgId).single();if(organization.data?.name!==company)throw Error('Refusing cleanup of an unexpected organization');const disabled=await admin.from('users').update({active:false}).eq('id',userId).eq('org_id',orgId);assert('Disposable probe membership disabled',!disabled.error);evidence.auditTenantRetained=true}
 if(userId){const removed=await admin.auth.admin.deleteUser(userId);assert('Only disposable probe identity removed',!removed.error)}
 evidence.cleanup=true;writeFileSync(resolve(out,'smoke.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2))
}
