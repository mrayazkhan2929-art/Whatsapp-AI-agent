'use client'

import { AlertCircle, Clock3, LoaderCircle } from 'lucide-react'

export function TransportStatus({ state, direction }: { state?: string | null; direction: 'inbound' | 'outbound' }) {
  const review = state === 'needs_review' || state === 'sending'
  const pending = state === 'prepared' || state === 'received' || state === 'processing'
  if (!review && !pending) return null
  const label = state === 'sending' ? 'Sending · awaiting confirmation'
    : state === 'needs_review' ? (direction === 'outbound' ? 'Delivery needs review' : 'Message needs review')
    : state === 'prepared' ? 'Saved · awaiting send' : 'Processing'
  const Icon = state === 'needs_review' ? AlertCircle : state === 'processing' || state === 'sending' ? LoaderCircle : Clock3
  const tone = direction === 'inbound'
    ? review ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-white/75'
    : review ? 'border-amber-400/40 bg-black/20 text-amber-50' : 'border-white/20 bg-black/15 text-white/90'
  return <span role="status" className={`mt-2 inline-flex max-w-full items-start gap-1.5 rounded-lg border px-2 py-1 text-[11px] leading-4 ${tone}`}>
    <Icon aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
    <span>{label}{state === 'needs_review' ? <span className="block text-[10px] opacity-80">{direction === 'outbound' ? 'Check delivery before sending again.' : 'Review this message before replying.'}</span> : null}</span>
  </span>
}
