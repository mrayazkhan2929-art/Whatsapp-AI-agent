'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Building2,Eye,EyeOff,ArrowRight,ShieldCheck,MessageSquare,Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeRedirect } from '@/lib/safe-redirect'

export function LoginPage({onLogin}:{onLogin?:()=>void}){
  const params=useSearchParams()
  const [mode,setMode]=useState<'login'|'register'|'onboard'>('login')
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState(''),[companyName,setCompanyName]=useState('')
  const [show,setShow]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null)
  async function submit(event:React.FormEvent){
    event.preventDefault();setLoading(true);setError(null);setNotice(null)
    try{
      const response=await fetch(mode==='login'?'/api/auth/login':'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({email:email.trim().toLowerCase(),password,name,companyName,action:mode})})
      const data=await response.json()
      if(!response.ok){
        if(data.code==='ONBOARDING_REQUIRED'){setMode('onboard');setNotice('Your account needs a workspace. Enter your company details to create one.');return}
        setError(typeof data.error==='string'?data.error:'Unable to continue');return
      }
      if(data.confirmationRequired){setMode('onboard');setNotice('Check your email and confirm your account. Then select Create workspace below.');return}
      if(!(await fetch('/api/auth/me',{credentials:'include',cache:'no-store'})).ok){setError('Your session could not be verified. Please sign in again.');return}
      onLogin?.();window.location.assign(mode==='login'?safeRedirect(params.get('redirect')):'/onboarding')
    }catch{setError('Unable to connect. Please try again.')}finally{setLoading(false)}
  }
  return <main className="min-h-dvh bg-background text-foreground grid lg:grid-cols-2">
    <section className="hidden lg:flex flex-col justify-between bg-slate-950 text-white p-12 xl:p-16 relative overflow-hidden" aria-label="Workspace introduction">
      <div className="absolute -top-20 -right-20 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden="true"/>
      <div className="flex items-center gap-3 text-lg font-semibold"><MessageSquare className="text-emerald-400"/>Conversation workspace</div>
      <div className="relative space-y-8 max-w-lg"><p className="text-sm font-medium tracking-widest uppercase text-emerald-300">Built around your business</p><h1 className="text-5xl font-semibold leading-tight tracking-tight">Better conversations.<br/>A clearer workspace.</h1><p className="text-lg text-slate-300 leading-relaxed">Bring your company, properties, knowledge and team together. Shape your AI, test every change and stay in control.</p><div className="grid gap-4"><p className="flex gap-3 items-center text-slate-200"><ShieldCheck className="h-5 w-5 text-emerald-300"/>Your company’s own workspace</p><p className="flex gap-3 items-center text-slate-200"><Sparkles className="h-5 w-5 text-emerald-300"/>AI and human support, working together</p></div></div>
      <p className="text-xs text-slate-400">Company workspace · WhatsApp AI</p>
    </section>
    <section className="flex items-center justify-center p-6 sm:p-10"><div className="w-full max-w-md space-y-8">
      <div><div className="mb-6 inline-flex rounded-2xl bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300"><Building2 aria-hidden="true"/></div><h2 className="text-3xl font-semibold tracking-tight">{mode==='login'?'Welcome back':mode==='register'?'Create your account':'Create your workspace'}</h2><p className="mt-2 text-muted-foreground">{mode==='login'?'Sign in to your company workspace.':'Start with your account and company. Configure the rest at your pace.'}</p></div>
      <form onSubmit={submit} className="space-y-5" aria-busy={loading}>
        {mode!=='login'&&<><div className="space-y-2"><Label htmlFor="company-name">Company name</Label><Input id="company-name" value={companyName} onChange={e=>setCompanyName(e.target.value)} required minLength={2} maxLength={100} autoComplete="organization" className="h-11"/></div><div className="space-y-2"><Label htmlFor="member-name">Your name</Label><Input id="member-name" value={name} onChange={e=>setName(e.target.value)} required maxLength={100} autoComplete="name" className="h-11"/></div></>}
        <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} autoComplete="email" placeholder="you@company.com" className="h-11"/></div>
        <div className="space-y-2"><Label htmlFor="password">Password</Label><div className="relative"><Input id="password" type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={mode==='login'?1:8} maxLength={256} autoComplete={mode==='register'?'new-password':'current-password'} className="h-11 pe-12"/><button type="button" aria-label={show?'Hide password':'Show password'} aria-pressed={show} onClick={()=>setShow(!show)} className="absolute end-1 top-1 h-9 w-10 flex items-center justify-center rounded-md text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{show?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}</button></div></div>
        {error&&<p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {notice&&<p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">{notice}</p>}
        <Button type="submit" disabled={loading} className="h-11 w-full gap-2">{loading?'Please wait…':mode==='login'?'Sign In':mode==='register'?'Create account':'Create workspace'}<ArrowRight className="h-4 w-4"/></Button>
      </form>
      <div className="text-center text-sm text-muted-foreground">{mode==='login'?'New to the workspace?':'Already have an account?'} <button disabled={loading} onClick={()=>{setMode(mode==='login'?'register':'login');setError(null);setNotice(null)}} className="font-medium text-foreground underline underline-offset-4">{mode==='login'?'Create an account':'Sign in'}</button></div>
    </div></section>
  </main>
}
