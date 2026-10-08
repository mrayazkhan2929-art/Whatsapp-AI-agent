import { createClient } from '@supabase/supabase-js'
import { NextRequest,NextResponse } from 'next/server'
import { resolveAuthToken } from '@/lib/authenticate'
import { proxyBackendRequest } from '@/lib/backend-api'
import { isSameOrigin } from '@/lib/request-origin'

export async function POST(request:NextRequest){
  // This endpoint deliberately never sets application cookies for an unmapped identity.
  if(!isSameOrigin(request))return NextResponse.json({error:'Invalid request origin'},{status:403})
  let body:Record<string,unknown>
  try{body=await request.json()}catch{return NextResponse.json({error:'Invalid request'},{status:400})}
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request'},{status:400})
  const {email,password,name,companyName,action}=body
  if(typeof email!=='string'||email.length>254||typeof password!=='string'||password.length>256||password.length<8||typeof name!=='string'||name.trim().length<1||name.length>100||typeof companyName!=='string'||companyName.trim().length<2||companyName.length>100||!['register','onboard'].includes(String(action)))return NextResponse.json({error:'Enter valid company, name, email and a password of at least 8 characters'},{status:400})
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL??process.env.SUPABASE_URL
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if(!url||!key)return NextResponse.json({error:'Authentication service unavailable'},{status:503})
  try{
    const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const credentials={email:email.trim().toLowerCase(),password}
    const result=action==='register'?await client.auth.signUp(credentials):await client.auth.signInWithPassword(credentials)
    if(result.error){const unavailable=result.error.status===0||(result.error.status??0)>=500||result.error.name==='AuthRetryableFetchError';return NextResponse.json({error:unavailable?'Authentication service unavailable':action==='register'?'Unable to register. If you already have an account, sign in.':'Invalid credentials'},{status:unavailable?503:action==='register'?400:401})}
    if(!result.data.session)return NextResponse.json({success:true,confirmationRequired:true,message:'Confirm your email, then return here to create your workspace.'},{status:202})
    const token=result.data.session.access_token
    const authorization=new NextRequest(request.url,{headers:{authorization:'Bearer '+token}})
    const onboard=await proxyBackendRequest(authorization,'/api/v1/auth/onboard',{method:'POST',body:JSON.stringify({name,companyName})})
    const payload=await onboard.json()
    if(!onboard.ok)return NextResponse.json(payload,{status:onboard.status})
    await resolveAuthToken(token)
    const response=NextResponse.json({success:true,data:payload.data},{status:201})
    const options={httpOnly:true,secure:request.nextUrl.protocol==='https:',sameSite:'lax' as const,maxAge:60*60*24*7,path:'/'}
    response.cookies.set('sb-access-token',token,options)
    response.cookies.set('sb-refresh-token',result.data.session.refresh_token,options)
    return response
  }catch(error){if(error instanceof NextResponse)return error;return NextResponse.json({error:'Workspace creation failed. Please try again.'},{status:500})}
}
