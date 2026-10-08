import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

type Reference = readonly [table: string, value: unknown, column?: string]

export async function checkTenantReferences(db: SupabaseClient, orgId: string, refs: readonly Reference[]) {
  for (const [table, value, column = 'id'] of refs) {
    if (value === null || value === undefined) continue
    if (typeof value !== 'string' || !value) return NextResponse.json({ error: 'Related resource not found' }, { status: 404 })
    const { data, error } = await db.from(table).select('id').eq('org_id', orgId).eq(column, value).limit(1)
    if (error) return NextResponse.json({ error: 'Related resource lookup failed' }, { status: 500 })
    if (!data?.length) {
      if (table === 'properties' && column === 'ref') {
        const alternate = await db.from(table).select('id').eq('org_id', orgId).eq('ref_number', value).limit(1)
        if (alternate.error) return NextResponse.json({ error: 'Related resource lookup failed' }, { status: 500 })
        if (alternate.data?.length) continue
      }
      return NextResponse.json({ error: 'Related resource not found' }, { status: 404 })
    }
  }
  return null
}

export async function checkTenantBulk(db: SupabaseClient, orgId: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) {
    return NextResponse.json({ error: 'Valid ids required' }, { status: 400 })
  }
  const unique = [...new Set(ids)]
  const { data, error } = await db.from('conversations').select('id').eq('org_id', orgId).in('id', unique)
  if (error) return NextResponse.json({ error: 'Resource lookup failed' }, { status: 500 })
  return data?.length === unique.length ? null : NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
}

// Prevent legacy malformed links from cascading changes into another tenant.
// These checks inspect only ownership violations, never return foreign row data.
const dependentTables: Record<string, Array<[string, string]>> = {
  contacts: [['conversations','contact_id'], ['contact_flows','contact_id'], ['bookings','contact_id'], ['lead_scores','contact_id'], ['nudge_jobs','contact_id'], ['handoff_events','contact_id'], ['lead_assignments','contact_id'], ['inventory_gaps','contact_id'], ['sentiment_history','contact_id'], ['alerts','contact_id']],
  conversations: [['messages','conversation_id'], ['bookings','conversation_id'], ['nudge_jobs','conversation_id'], ['handoff_events','conversation_id'], ['inventory_gaps','conversation_id'], ['alerts','conversation_id']],
  messages: [['sentiment_history','message_id']],
  devices: [['conversations','device_id'], ['baileys_sessions','device_id'], ['nudge_jobs','device_id']],
  knowledge_bases: [['knowledge_chunks','knowledge_base_id'], ['agents','knowledge_base_id']],
  flows: [['flow_steps','flow_id'], ['agents','default_flow_id'], ['contact_flows','flow_id']],
}
export async function checkTenantDeletion(db: SupabaseClient, orgId: string, table: string, ids: string[]): Promise<NextResponse | null> {
  for (const [child, column] of dependentTables[table] ?? []) {
    const foreign = await db.from(child).select('id').in(column, ids).neq('org_id', orgId).limit(1)
    if (foreign.error) return NextResponse.json({ error: 'Dependency lookup failed' }, { status: 500 })
    if (foreign.data?.length) return NextResponse.json({ error: 'Inconsistent tenant dependencies; deletion blocked' }, { status: 409 })
    if (dependentTables[child]) {
      const owned = await db.from(child).select('id').eq('org_id', orgId).in(column, ids)
      if (owned.error) return NextResponse.json({ error: 'Dependency lookup failed' }, { status: 500 })
      if (owned.data?.length) {
        const denied = await checkTenantDeletion(db, orgId, child, owned.data.map(row => row.id as string))
        if (denied) return denied
      }
    }
  }
  return null
}

