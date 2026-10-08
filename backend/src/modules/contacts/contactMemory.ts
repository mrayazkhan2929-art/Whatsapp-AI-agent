import { extractStructuredCriteria } from '../ai/StructuredIntentClassifier.js'
import { getSupabaseAdmin } from '../../config/supabase.js'

export interface ContactMemory {
  language: 'en' | 'ar'
  intent: 'buy' | 'rent' | 'invest' | 'unknown'
  area?: string
  bedrooms?: string
  maxBudget?: number
  minBudget?: number
  transactionType?: 'SALE' | 'RENT'
  propertyType?: 'apartment'|'villa'|'townhouse'|'penthouse'
  referenceNumber?: string
  project?: string
  building?: string
  status?: 'ready'|'off-plan'
  developer?: string
  distressOnly?: boolean
  assignedAgentId?: string
  assignedAgentName?: string
  assignedAgentPhone?: string
  leadScore: 'cold' | 'warm' | 'hot' | 'vip'
  isFirstMessage: boolean
  messageCount: number
  lastIntent?: string
  lastShownPropertyRefs?: string
  viewingRequested?: boolean
  handoffTriggered?: boolean
}

const DEFAULT_MEMORY: ContactMemory = {
  language: 'en',
  intent: 'unknown',
  leadScore: 'cold',
  isFirstMessage: true,
  messageCount: 0,
}

async function getContactId(phoneNumber: string, orgId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('phone', phoneNumber)
    .eq('org_id', orgId)
    .maybeSingle()

  return data?.id ?? null
}

function parseMemoryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)
  return value
}

export async function readMemory(phoneNumber: string, orgId: string): Promise<ContactMemory> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return { ...DEFAULT_MEMORY }

  try {
    const contactId = await getContactId(phoneNumber, orgId)
    if (!contactId) return { ...DEFAULT_MEMORY }

    const { data: memoryRows } = await supabase
      .from('contact_memory')
      .select('key, value')
      .eq('contact_id', contactId)

    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in(
        'conversation_id',
        (
          await supabase
            .from('conversations')
            .select('id')
            .eq('org_id', orgId)
            .eq('contact_id', contactId)
        ).data?.map((row) => row.id) ?? [],
      )

    const memory = Object.fromEntries(
      (memoryRows ?? []).map((row) => [row.key, parseMemoryValue(row.value)]),
    ) as Partial<ContactMemory>

    return {
      ...DEFAULT_MEMORY,
      ...memory,
      isFirstMessage: (count ?? 0) <= 1,
      messageCount: count ?? 0,
    }
  } catch (error) {
    console.warn('[MEMORY] Read failed:', error)
    return { ...DEFAULT_MEMORY }
  }
}

export async function updateMemory(
  phoneNumber: string,
  orgId: string,
  patch: Partial<ContactMemory>,
): Promise<void> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return

  try {
    const contactId = await getContactId(phoneNumber, orgId)
    if (!contactId) return

    const now = new Date().toISOString()
    const rows = Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({
        contact_id: contactId,
        key,
        value: String(value),
        updated_at: now,
      }))

    if (rows.length === 0) return

    const { error } = await supabase
      .from('contact_memory')
      .upsert(rows, { onConflict: 'contact_id,key' })

    if (error) {
      console.warn('[MEMORY] Update failed:', error.message)
    }
  } catch (error) {
    console.warn('[MEMORY] Update failed:', error)
  }
}

export async function extractAndUpdateMemory(
  phoneNumber: string,
  orgId: string,
  message: string,
  currentMemory: ContactMemory,
): Promise<ContactMemory> {
  const lower = message.toLowerCase()
  const patch: Partial<ContactMemory> = {}

  if (/[\u0600-\u06FF]/.test(message)) patch.language = 'ar'

  const criteria=extractStructuredCriteria(message,currentMemory as unknown as Record<string,unknown>)
  Object.assign(patch,{ area:criteria.area,bedrooms:criteria.bedrooms,minBudget:criteria.minPrice,maxBudget:criteria.maxPrice,
    transactionType:criteria.transactionType,propertyType:criteria.propertyType,referenceNumber:criteria.referenceNumber,
    project:criteria.project,building:criteria.building,status:criteria.status,developer:criteria.developer,distressOnly:criteria.distressOnly })
  if (criteria.transactionType) patch.intent=criteria.transactionType==='SALE'?'buy':'rent'

  if (/\b(ready|serious|today|urgent|sign|deposit|now)\b/.test(lower)) {
    patch.leadScore = 'hot'
  } else if (/\b(interested|viewing|visit|schedule|book)\b/.test(lower)) {
    if (currentMemory.leadScore === 'cold') patch.leadScore = 'warm'
  }

  const updated = { ...currentMemory, ...patch, isFirstMessage: false }
  await updateMemory(phoneNumber, orgId, patch)
  return updated
}
