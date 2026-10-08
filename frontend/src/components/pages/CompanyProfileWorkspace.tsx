'use client'

import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, Clock3, Globe2, Loader2, Mail, MapPin, Phone, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useAuthProfile } from '@/lib/use-auth-profile'
import { emptyCompanyProfile, fetchCompanyProfile, saveCompanyProfile, type CompanyProfile, type CompanyProfileDraft } from '@/lib/company-profile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

type Pairs = Array<[string, string]>
const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)
const scalarFields = ['legal_name', 'short_name', 'description', 'logo_url', 'office_address', 'map_url', 'website', 'email', 'phone', 'whatsapp', 'timezone', 'license_number', 'license_authority', 'legal_disclaimer'] as const
type ScalarField = typeof scalarFields[number]

function Field({ label, hint, multiline = false, required = false, value, onChange, type = 'text', maxLength = 2000 }: {
  label: string; hint?: string; multiline?: boolean; required?: boolean; value: string; onChange: (value: string) => void; type?: string; maxLength?: number
}) {
  const id = useId()
  const props = { id, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), required, maxLength, 'aria-label': label, 'aria-describedby': hint ? id + '-hint' : undefined }
  return <div className="space-y-2">
    <Label htmlFor={id} className="text-sm font-medium">{label}{required && <span className="ml-1 text-emerald-600" aria-hidden="true">*</span>}</Label>
    {multiline ? <Textarea {...props} rows={3} className="resize-y bg-background" /> : <Input {...props} type={type} className="h-11 bg-background" />}
    {hint && <p id={id + '-hint'} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
  </div>
}

function PairEditor({ title, pairs, onChange, link = false }: { title: string; pairs: Pairs; onChange: (pairs: Pairs) => void; link?: boolean }) {
  return <div className="space-y-3">
    <p className="text-sm font-medium">{title}</p>
    {pairs.map(([key, value], index) => <div key={index} className="flex flex-wrap gap-2 sm:flex-nowrap">
      <Input aria-label={`${title} label ${index + 1}`} placeholder={link ? 'Platform' : 'Fact name'} value={key} maxLength={80} className="sm:w-1/3" onChange={event => onChange(pairs.map((pair, i) => i === index ? [event.target.value, pair[1]] : pair))} />
      <Input aria-label={`${title} value ${index + 1}`} placeholder={link ? 'https://…' : 'Verified detail'} value={value} type={link ? 'url' : 'text'} maxLength={2000} onChange={event => onChange(pairs.map((pair, i) => i === index ? [pair[0], event.target.value] : pair))} />
      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${title} ${index + 1}`} onClick={() => onChange(pairs.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
    </div>)}
    <Button type="button" size="sm" variant="outline" disabled={pairs.length >= (link ? 15 : 30)} onClick={() => onChange([...pairs, ['', '']])}><Plus className="mr-1 h-4 w-4" />Add {link ? 'social link' : 'company fact'}</Button>
  </div>
}

function ProfileEditor({ profile, canEdit, orgId }: { profile: CompanyProfile | null; canEdit: boolean; orgId: string }) {
  const queryClient = useQueryClient()
  const initial = profile ?? emptyCompanyProfile
  const [draft, setDraft] = useState<CompanyProfileDraft>(initial)
  const [areas, setAreas] = useState(initial.service_areas.join('\n'))
  const [statements, setStatements] = useState(initial.approved_marketing_statements.join('\n'))
  const [social, setSocial] = useState<Pairs>(Object.entries(initial.social_links))
  const [facts, setFacts] = useState<Pairs>(Object.entries(initial.company_facts))
  const [error, setError] = useState('')
  const [section, setSection] = useState('identity')
  const current = { ...draft, service_areas: lines(areas), approved_marketing_statements: lines(statements), social_links: Object.fromEntries(social), company_facts: Object.fromEntries(facts) }
  const dirty = scalarFields.some(key => draft[key] !== initial[key]) || draft.working_hours.summary !== initial.working_hours.summary || areas !== initial.service_areas.join('\n') || statements !== initial.approved_marketing_statements.join('\n') || JSON.stringify(social) !== JSON.stringify(Object.entries(initial.social_links)) || JSON.stringify(facts) !== JSON.stringify(Object.entries(initial.company_facts))
  const mutation = useMutation({ mutationFn: saveCompanyProfile, onSuccess: value => {
    queryClient.setQueryData(['company-profile', orgId], value)
    setError('')
  }, onError: cause => setError(cause.message) })
  useEffect(() => {
    if (!dirty) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [dirty])
  const update = (key: ScalarField, value: string) => setDraft(previous => ({ ...previous, [key]: value }))
  const field = (key: ScalarField, label: string, options: Partial<React.ComponentProps<typeof Field>> = {}) => <Field label={label} value={draft[key]} onChange={value => update(key, value)} {...options} />
  const reset = () => { setDraft(initial); setAreas(initial.service_areas.join('\n')); setStatements(initial.approved_marketing_statements.join('\n')); setSocial(Object.entries(initial.social_links)); setFacts(Object.entries(initial.company_facts)); setError('') }
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canEdit || mutation.isPending) return
    if (!draft.legal_name.trim()) { setSection('identity'); setError('Company name is required.'); return }
    for (const key of ['logo_url', 'map_url', 'website'] as const) {
      if (draft[key] && (!/^https?:\/\//i.test(draft[key]) || !URL.canParse(draft[key]))) { setError('Use valid HTTP or HTTPS links.'); return }
    }
    for (const pairs of [social, facts]) {
      const keys = pairs.map(([key]) => key.trim())
      if (keys.some(key => !key) || new Set(keys).size !== keys.length || pairs.some(([, value]) => !value.trim())) { setError('Each link and fact needs a unique label and a value.'); return }
    }
    mutation.mutate(current)
  }
  const brand = draft.short_name || draft.legal_name || 'Your company'
  const completeness = [draft.legal_name, draft.description, draft.office_address, draft.phone, draft.email, draft.website, draft.working_hours.summary, draft.logo_url].filter(value => value.trim()).length
  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
    <form onSubmit={save} noValidate className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="border-b px-6 py-5"><h2 className="font-semibold">Company details</h2><p className="mt-1 text-sm text-muted-foreground">Keep your team and your assistant on the same page.</p></div>
      <Tabs value={section} onValueChange={setSection} className="gap-0">
        <div className="overflow-x-auto border-b bg-muted/20 px-4 py-3"><TabsList aria-label="Company profile sections" className="h-auto bg-transparent"><TabsTrigger value="identity">Identity</TabsTrigger><TabsTrigger value="contact">Contact</TabsTrigger><TabsTrigger value="operations">Operations</TabsTrigger><TabsTrigger value="trust">Trust & facts</TabsTrigger></TabsList></div>
        <fieldset disabled={!canEdit || mutation.isPending} className="min-w-0">
          <TabsContent value="identity" className="space-y-6 p-6">
            <div className="grid gap-5 sm:grid-cols-2">{field('legal_name', 'Company name', { required: true, maxLength: 200 })}{field('short_name', 'Brand name', { maxLength: 100, hint: 'Shown in the workspace sidebar.' })}</div>
            {field('description', 'Company description', { multiline: true, maxLength: 4000, hint: 'A clear introduction your assistant can use in conversations.' })}
            {field('logo_url', 'Logo URL', { type: 'url', hint: 'Use an HTTPS image link. The preview updates as you type.' })}
          </TabsContent>
          <TabsContent value="contact" className="space-y-6 p-6">
            {field('office_address', 'Office address', { multiline: true })}
            {field('map_url', 'Map URL', { type: 'url' })}
            <div className="grid gap-5 sm:grid-cols-2">{field('phone', 'Phone', { type: 'tel', maxLength: 80 })}{field('whatsapp', 'WhatsApp', { type: 'tel', maxLength: 80 })}{field('email', 'Email', { type: 'email', maxLength: 320 })}{field('website', 'Website', { type: 'url' })}</div>
            <PairEditor title="Social links" pairs={social} onChange={setSocial} link />
          </TabsContent>
          <TabsContent value="operations" className="space-y-6 p-6">
            {field('timezone', 'Timezone', { maxLength: 100, hint: 'An IANA timezone, such as Asia/Dubai, Europe/London or UTC.' })}
            <Field label="Working hours" multiline value={draft.working_hours.summary} maxLength={1000} onChange={value => setDraft(previous => ({ ...previous, working_hours: { summary: value } }))} hint="Include days, opening times and exceptions." />
            <Field label="Service areas" multiline value={areas} onChange={setAreas} maxLength={25000} hint="One service area per line." />
          </TabsContent>
          <TabsContent value="trust" className="space-y-6 p-6">
            <div className="grid gap-5 sm:grid-cols-2">{field('license_number', 'License number', { maxLength: 200 })}{field('license_authority', 'License authority', { maxLength: 200 })}</div>
            {field('legal_disclaimer', 'Legal disclaimer', { multiline: true, maxLength: 4000 })}
            <Field label="Approved marketing statements" multiline value={statements} onChange={setStatements} maxLength={25000} hint="One verified statement per line. Avoid claims you cannot support." />
            <PairEditor title="Company facts" pairs={facts} onChange={setFacts} />
          </TabsContent>
        </fieldset>
      </Tabs>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t bg-card/95 px-6 py-4 backdrop-blur-sm">
        <div className="text-sm" role="status" aria-live="polite">{mutation.isPending ? <span className="text-muted-foreground">Saving company profile…</span> : dirty ? <span className="text-amber-600 dark:text-amber-400">Unsaved changes</span> : <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Check className="h-4 w-4 text-emerald-500" />{profile ? 'All changes saved' : 'Ready to configure'}</span>}</div>
        {canEdit && <div className="flex gap-2"><Button type="button" variant="ghost" disabled={!dirty || mutation.isPending} onClick={reset}>Discard changes</Button><Button type="submit" disabled={(!dirty && Boolean(profile)) || mutation.isPending} className="bg-emerald-600 text-white hover:bg-emerald-700">{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save profile</Button></div>}
      </div>
      {error && <p role="alert" className="border-t bg-destructive/5 px-6 py-4 text-sm text-destructive">{error}</p>}
    </form>
    <aside className="space-y-4 xl:sticky xl:top-6" aria-label="Live brand preview">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4"><h2 className="text-sm font-semibold">Live brand preview</h2><Badge variant="secondary" className="text-[10px]">{dirty ? 'Draft' : 'Saved'}</Badge></div>
        <div className="h-16 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent" />
        <div className="space-y-5 px-5 pb-6">
          <Avatar className="-mt-7 h-14 w-14 rounded-2xl border-4 border-card shadow-sm"><AvatarImage src={draft.logo_url || undefined} alt={`${brand} logo preview`} className="bg-background object-contain p-1" /><AvatarFallback className="rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Building2 className="h-6 w-6" /></AvatarFallback></Avatar>
          <div className="space-y-2"><h3 className="break-words text-lg font-semibold">{brand}</h3>{draft.short_name && <p className="break-words text-xs text-muted-foreground">{draft.legal_name}</p>}<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{draft.description || 'Your company introduction will appear here.'}</p></div>
          <div className="space-y-3 text-xs text-muted-foreground">{[[MapPin, draft.office_address || 'Add your office address'], [Phone, draft.phone || 'Add your phone number'], [Mail, draft.email || 'Add your email'], [Globe2, draft.website || 'Add your website'], [Clock3, draft.working_hours.summary || 'Add your working hours']].map(([Icon, value], index) => { const PreviewIcon = Icon as typeof MapPin; return <div key={index} className="flex items-start gap-2.5"><PreviewIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="whitespace-pre-wrap break-all">{value as string}</span></div> })}</div>
          {current.service_areas.length > 0 && <div className="flex flex-wrap gap-1.5">{current.service_areas.slice(0, 5).map((area, index) => <Badge key={index} variant="secondary" className="max-w-full truncate text-[10px]">{area}</Badge>)}</div>}
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-5"><div className="flex justify-between text-xs"><span className="font-medium">Profile completeness</span><span className="text-muted-foreground">{completeness} of 8 essentials</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={completeness} aria-valuemin={0} aria-valuemax={8} aria-label="Profile completeness"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${completeness / 8 * 100}%` }} /></div><p className="mt-3 text-xs leading-relaxed text-muted-foreground">A complete profile helps your assistant give accurate company answers.</p></div>
      <div className="flex gap-3 rounded-2xl bg-emerald-500/5 p-5"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><p className="text-xs leading-relaxed text-muted-foreground">Saved details are used in your company replies. Review facts and links before saving.</p></div>
    </aside>
  </div>
}

export function CompanyProfileWorkspace() {
  const auth = useAuthProfile()
  const query = useQuery({ queryKey: ['company-profile', auth.profile?.orgId], queryFn: fetchCompanyProfile, enabled: Boolean(auth.profile), refetchOnWindowFocus: false, staleTime: 30_000 })
  const canEdit = ['owner', 'admin'].includes(auth.profile?.role ?? '')
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">Your company, connected</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Company profile</h1><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">One trusted source for your brand, contact details and company facts.</p></div><Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />Company workspace</Badge></header>
    {!canEdit && auth.profile && <p className="rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">You can view this profile. An owner or administrator can update it.</p>}
    {auth.isError || query.isError ? <div role="alert" className="rounded-2xl border p-8"><p className="mb-4">Company profile could not be loaded.</p><Button variant="outline" onClick={() => { void auth.refetch(); void query.refetch() }}>Retry</Button></div> : !auth.profile || query.isPending ? <div aria-label="Loading company profile" className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full rounded-2xl" /></div> : <ProfileEditor key={`${auth.profile.orgId}:${query.data?.updated_at ?? 'unconfigured'}`} profile={query.data ?? null} canEdit={canEdit} orgId={auth.profile.orgId} />}
  </div>
}
