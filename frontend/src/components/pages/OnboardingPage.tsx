'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight,Check,RefreshCw,Compass,ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const steps=[
  ['company','Company profile','Give your AI verified company information.','/settings'],
  ['agent','Your AI agent','Create an agent for this workspace.','/ai-studio'],
  ['instructions','Instructions & voice','Set your agent’s role, languages and boundaries.','/ai-studio'],
  ['knowledge','Knowledge','Upload a document and wait for indexing to finish.','/knowledge-base'],
  ['properties','Property inventory','Add verified properties, availability and media.','/properties'],
  ['team','Your team','Add the people who handle customer conversations.','/team'],
  ['handoff','Human handoff','Review routing rules and save your handoff settings.','/settings/handoff'],
  ['device','Connect WhatsApp','Add a device and scan its QR code.','/devices'],
  ['test','Test your AI','Run a preview in AI Studio before publishing.','/ai-studio'],
  ['publish','Publish','Publish a tested configuration and link your channel.','/ai-studio'],
  ['operate','First conversation','Send a real message to your connected number and review the Inbox.','/inbox'],
] as const
export function OnboardingPage(){
  const query=useQuery<{complete:Record<string,boolean>;canConfigure:boolean}>({queryKey:['onboarding'],queryFn:async()=>{const response=await fetch('/api/auth/onboarding',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error??'Unable to load workspace progress');return data.data},refetchInterval:15_000})
  const completed=steps.filter(([key])=>query.data?.complete[key]).length
  return <section className="mx-auto max-w-5xl space-y-8" aria-labelledby="onboarding-title">
    <div className="rounded-3xl border bg-card p-6 sm:p-8 shadow-sm"><div className="flex items-start justify-between gap-4"><div><span className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><Compass className="h-4 w-4"/>Getting started</span><h1 id="onboarding-title" className="mt-3 text-3xl font-semibold tracking-tight">Make this workspace yours</h1><p className="mt-3 max-w-2xl text-muted-foreground">Everything your team needs to launch, in one place. Progress is based on your saved workspace data. Return here whenever you need your next step.</p></div><Button variant="outline" size="icon" aria-label="Refresh workspace progress" disabled={query.isFetching} onClick={()=>query.refetch()}><RefreshCw className={query.isFetching?'h-4 w-4 animate-spin':'h-4 w-4'}/></Button></div>
      <div className="mt-6 flex gap-3 items-center"><div role="progressbar" aria-label="Workspace setup" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={completed} className="h-2 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{width:`${completed/steps.length*100}%`}}/></div><span className="text-sm text-muted-foreground">{completed} of {steps.length}</span></div>
    </div>
    {query.isPending?<div aria-label="Loading workspace progress" className="grid gap-4 sm:grid-cols-2">{Array.from({length:4},(_,i)=><Skeleton key={i} className="h-36 rounded-2xl"/>)}</div>:query.isError?<div role="alert" className="rounded-2xl border border-destructive/30 p-6"><p>{query.error.message}</p><Button className="mt-3" onClick={()=>query.refetch()}>Try again</Button></div>:<>
      {!query.data.canConfigure&&<p role="status" className="rounded-xl border p-4 text-sm">An owner or administrator can configure this workspace. You can review progress and open the areas available to your role.</p>}
      <ol className="grid gap-4 sm:grid-cols-2">{steps.map(([key,title,description,href],index)=>{const done=query.data.complete[key];return <li key={key} className="rounded-2xl border bg-card p-5 flex gap-4 shadow-sm"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium ${done?'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300':'bg-muted text-muted-foreground'}`} aria-label={done?'Complete':`Step ${index+1}`}>{done?<Check className="h-4 w-4"/>:index+1}</span><div className="min-w-0 flex-1"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground leading-relaxed">{description}</p><Link className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300 underline-offset-4 hover:underline" href={href}>{done?'Review':'Open'} {title}<ArrowUpRight className="h-3.5 w-3.5"/></Link></div></li>})}</ol>
    </>}
    <p className="flex items-start gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0 mt-0.5"/>A connected device and published agent do not replace a live test. Verify the first reply and human handoff in your own WhatsApp account before launch.</p>
  </section>
}
