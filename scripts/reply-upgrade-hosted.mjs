// Owner-authorized SARA rollout and HTTPS dry-run acceptance. Never calls WhatsApp.
// Credentials and detailed synthetic results stay in ignored test-results.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'test-results/reply-upgrade')
const credentials=JSON.parse(readFileSync(resolve(root,'test-results/deployment/credentials.json'),'utf8'))
const before=JSON.parse(readFileSync(resolve(out,'before.json'),'utf8'))
if(credentials.SUPABASE_URL!=='https://jpfoebdljdyzoxznsgax.supabase.co')throw Error('Unexpected deployment project')
const admin=createClient(credentials.SUPABASE_URL,credentials.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const base='https://frontend-production-3cb5.up.railway.app',agent=before.agent,org=before.org
const identity={email:'reply-acceptance-'+randomUUID()+'@example.invalid',password:randomBytes(30).toString('base64url')}
const evidence={at:new Date().toISOString(),scope:'Authenticated HTTPS playground through both hosted applications; no transport send',checks:[],turns:[],whatsappMessagesSent:0,transportTargetAchieved:false}
let userId,headers
const save=()=>writeFileSync(resolve(out,'hosted.json'),JSON.stringify(evidence,null,2)+'\n')
const check=(name,passed)=>{evidence.checks.push({name,passed:!!passed});save();if(!passed)throw Error('Failed: '+name)}
const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const read=async(table)=>{const r=await admin.from(table).select('*').eq('org_id',org);if(r.error)throw Error('Snapshot read failed: '+table);return r.data}
const call=async(path,method='GET',body)=>{
 const start=performance.now(),r=await fetch(base+path,{method,headers:headers??{origin:base,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)})
 const payload=await r.json().catch(()=>null)
 if(!r.ok||!payload?.success)throw Error('Hosted operation failed: '+r.status+' '+path+' '+(payload?.error?.code??''))
 return {data:payload.data,elapsedMs:Math.round(performance.now()-start),response:r}
}
try{
 const scoped=await admin.from('agents').select('id,published_version_id').eq('org_id',org).eq('id',agent).single()
 check('Snapshot identifies the existing owned SARA',!scoped.error&&scoped.data?.id===agent)
 const created=await admin.auth.admin.createUser({...identity,email_confirm:true})
 check('Temporary test identity created without email',!created.error&&!!created.data.user?.id);userId=created.data.user.id
 const member=await admin.from('users').insert({id:userId,org_id:org,name:'Disposable reply acceptance',email:identity.email,role:'admin',active:true,password_hash:'supabase-auth-only'})
 check('Temporary test membership explicitly scoped to IERE',!member.error)
 const login=await call('/api/auth/login','POST',identity),cookies=login.response.headers.getSetCookie()
 check('Login authorized before secure cookies',cookies.length>=2&&cookies.every(c=>/Secure/i.test(c)&&/HttpOnly/i.test(c)))
 headers={cookie:cookies.map(c=>c.split(';')[0]).join('; '),origin:base,'content-type':'application/json'}
 check('Canonical membership matches expected tenant',(await call('/api/auth/me')).data.orgId===org)
 const current=(await call('/api/agents/'+agent+'/draft')).data
 const versions=(await call('/api/agents/'+agent+'/versions')).data
 const published=versions.find(v=>v.id===scoped.data.published_version_id)
 check('Current published configuration exists',!!published)
 const concise=structuredClone(published.config);concise.identity.responseLength='short'
 if(process.argv.includes('--publish')){
  check('No owner draft edits would be overwritten',hash(current.config)===hash(published.config)||hash(current.config)===hash(concise))
  const payload={expectedRevision:current.revision,expectedPublishedVersionId:scoped.data.published_version_id,config:concise}
  const saved=(await call('/api/agents/'+agent+'/draft','PATCH',payload)).data
  const checked=(await call('/api/agents/'+agent+'/test','POST',{expectedRevision:saved.draft?.revision??saved.revision,expectedPublishedVersionId:scoped.data.published_version_id})).data
  check('All mandatory draft checks pass',checked.tests?.every(t=>t.passed)&&checked.providerCalls===0&&checked.whatsappSends===0)
  const released=(await call('/api/agents/'+agent+'/publish','POST',{expectedRevision:saved.draft?.revision??saved.revision,expectedPublishedVersionId:scoped.data.published_version_id})).data
  evidence.release=released
 }
 const draft=(await call('/api/agents/'+agent+'/draft')).data
 const runtime=(await call('/api/agents/runtime/current?deviceId='+before.device)).data
 check('Published concise configuration preserves all other settings',hash(runtime.config)===hash(concise))
 evidence.publishedVersionId=runtime.publishedVersionId;evidence.versionNumber=runtime.versionNumber
 const refs=before.properties.filter(p=>p.available&&(p.ref_number||p.ref)).map(p=>p.ref_number??p.ref)
 const sessions=new Map()
 const turns=[
  ['greeting','Hello'],['greeting-ar','مرحبا'],['address','What is your office address?'],['address-ar','ما عنوان مكتبكم؟'],
  ['map','Send your office map'],['phone','What is your office phone?'],['website','What is your website?'],['email','What is your email?'],['hours','What are your working hours?'],['missing-fact','Who is your CEO?'],
  ['one','Show me one property in JVC','search1','clarify-transaction'],['rent','Rent','search1','at-most-one'],['details','More details','search1'],['cheaper','Anything cheaper?','search1'],['same-area','Same area please','search1'],
  ['three','Show me 3 properties for rent in JVC','search2','at-most-three'],['second','The second one','search2','second'],['arabic-details','تفاصيل أكثر','search2'],
  ['buy','Show me one property to buy in JVC','search3','at-most-one'],['correction','Actually rent instead, under 90000 AED','search3'],['same-area-ar','نفس المنطقة','search3'],
  ['reference','Ref '+refs[0],'ref1','at-most-one'],['reference-details','More details','ref1'],
  ['general','What should I consider before choosing an apartment?'],['general-ar','كيف أختار شقة مناسبة؟'],['greeting-context','Hello how are you today?'],
  ['one-jlt','Just one in JLT','search4','clarify-transaction'],['rent-jlt','Rent','search4','at-most-one'],['budget-correction','Actually JVC instead, two bedrooms under 100000 AED','search4'],['language-followup','هل يوجد خيار أرخص؟','search4'],
 ]
 for(const [label,message,key=label,assertion] of turns){
  const session=sessions.get(key)??{state:{excludeRefs:[]},dialogue:{},history:[]}
  const result=await call('/api/agents/'+agent+'/playground','POST',{expectedRevision:draft.revision,message,mode:'model',state:session.state,dialogue:session.dialogue,history:session.history.slice(-10),language:session.language})
  const d=result.data,previousRefs=session.dialogue.lastListingRefs??[]
  const providerOutcome=d.executionEvidence?.interpretationOutcome
  const providerFailure=['timeout','network_failed','provider_failed','rate_limited','invalid_output','unavailable'].includes(providerOutcome)||!!d.executionEvidence?.fallback
  const row={label,elapsedMs:result.elapsedMs,providerFailure,interpretationOutcome:providerOutcome,stages:d.executionEvidence?.stageDurationsMs??{},properties:d.retrievedProperties?.length??0,finalResponse:d.finalResponse,assertions:[]}
  evidence.turns.push(row)
  check('No customer side effects: '+label,Object.values(d.sideEffects).every(n=>n===0))
  if(assertion==='at-most-one')row.assertions.push({name:assertion,passed:row.properties<=1})
  if(assertion==='at-most-three')row.assertions.push({name:assertion,passed:row.properties<=3})
  if(assertion==='clarify-transaction')row.assertions.push({name:assertion,passed:d.finalResponse==='Are you looking to buy or rent?'&&row.properties===0})
  if(assertion==='second'&&previousRefs.length>=2&&!providerFailure)row.assertions.push({name:assertion,passed:row.properties===1&&d.retrievedProperties[0].reference===previousRefs[1]})
  if(label==='address')row.assertions.push({name:'address only',passed:d.finalResponse===before.organization_profiles[0].office_address})
  for(const item of row.assertions)check(label+': '+item.name,item.passed)
  sessions.set(key,{state:d.conversationState.criteria,dialogue:d.conversationState.dialogue??{},language:d.responseLanguage,history:[...session.history,{role:'user',content:message},{role:'assistant',content:d.finalResponse}].slice(-10)})
  save();console.log(JSON.stringify({label,elapsedMs:row.elapsedMs,providerFailure,properties:row.properties}))
 }
 const summary=rows=>{const values=rows.map(t=>t.elapsedMs).sort((a,b)=>a-b);return {count:values.length,medianMs:values.length?values[Math.ceil(values.length*.5)-1]:null,p95Ms:values.length?values[Math.ceil(values.length*.95)-1]:null}}
 evidence.benchmark={metric:'Authenticated hosted preview HTTP duration, includes trace persistence; NOT inbound-to-WhatsApp transport acknowledgement',all:summary(evidence.turns),withoutProviderFailures:summary(evidence.turns.filter(t=>!t.providerFailure)),providerFailures:evidence.turns.filter(t=>t.providerFailure).map(t=>({label:t.label,outcome:t.interpretationOutcome,elapsedMs:t.elapsedMs}))}
 check('All 204 inventory rows are unchanged',hash(await read('properties'))===hash(before.properties))
 check('Company profile unchanged',hash(await read('organization_profiles'))===hash(before.organization_profiles))
 const device=(await call('/api/devices/'+before.device)).data
 evidence.device={id:before.device,status:device.status,isLiveConnected:device.isLiveConnected}
 check('Existing paired device remains connected',device.isLiveConnected===true||device.status==='connected')
 const anonymous=createClient(credentials.SUPABASE_URL,credentials.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
 check('Context RPC inaccessible to anonymous clients',(await anonymous.rpc('load_reply_context',{p_org_id:org,p_device_id:before.device,p_conversation_id:'d6fd4cfc-1dcd-4d78-9028-8ea4371f7caa'})).error?.code==='42501')
}catch(error){evidence.error=error.message;process.exitCode=1}
finally{
 if(userId){
  const disabled=await admin.from('users').update({active:false}).eq('org_id',org).eq('id',userId)
  const removed=await admin.auth.admin.deleteUser(userId)
  evidence.cleanup={membershipDisabled:!disabled.error,authIdentityRemoved:!removed.error,auditMemberRetained:true}
  if(disabled.error||removed.error)process.exitCode=1
 }
 save();console.log(JSON.stringify({checks:evidence.checks.length,error:evidence.error??null,benchmark:evidence.benchmark,cleanup:evidence.cleanup,publishedVersionId:evidence.publishedVersionId,versionNumber:evidence.versionNumber}))
}
