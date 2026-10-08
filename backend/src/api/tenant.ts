import type { SupabaseClient } from '@supabase/supabase-js'

type Reference = readonly [table: string, value: unknown, column?: string]

// Service-role foreign keys do not imply tenant ownership. Check before side effects.
export async function checkTenantReferences(db: SupabaseClient, orgId: string, refs: readonly Reference[]) {
  for (const [table, value, column = 'id'] of refs) {
    if (value === null || value === undefined) continue
    if (typeof value !== 'string' || !value) return { status: 404, code: 'RESOURCE_NOT_FOUND', error: 'Related resource was not found' }
    const { data, error } = await db.from(table).select('id').eq('org_id', orgId).eq(column, value).limit(1)
    if (error) return { status: 500, code: 'TENANT_LOOKUP_FAILED', error: 'Related resource lookup failed' }
    if (!data?.length) {
      if (table === 'properties' && column === 'ref') {
        const alternate = await db.from(table).select('id').eq('org_id', orgId).eq('ref_number', value).limit(1)
        if (alternate.error) return { status: 500, code: 'TENANT_LOOKUP_FAILED', error: 'Related resource lookup failed' }
        if (alternate.data?.length) continue
      }
      return { status: 404, code: 'RESOURCE_NOT_FOUND', error: 'Related resource was not found' }
    }
  }
  return null
}

export async function checkTenantBulk(db: SupabaseClient, orgId: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !id)) {
    return { status: 400, code: 'IDS_REQUIRED', error: 'Valid ids required' }
  }
  const unique = [...new Set(ids)]
  const { data, error } = await db.from('conversations').select('id').eq('org_id', orgId).in('id', unique)
  if (error) return { status: 500, code: 'TENANT_LOOKUP_FAILED', error: 'Resource lookup failed' }
  return data?.length === unique.length ? null : { status: 404, code: 'RESOURCE_NOT_FOUND', error: 'Conversation was not found' }
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
export async function checkTenantDeletion(db: SupabaseClient, orgId: string, table: string, ids: string[]): Promise<{ status: number; code: string; error: string } | null> {
  for (const [child, column] of dependentTables[table] ?? []) {
    const foreign = await db.from(child).select('id').in(column, ids).neq('org_id', orgId).limit(1)
    if (foreign.error) return { status: 500, code: 'TENANT_LOOKUP_FAILED', error: 'Dependency lookup failed' }
    if (foreign.data?.length) return { status: 409, code: 'TENANT_DEPENDENCY_CONFLICT', error: 'Inconsistent tenant dependencies; deletion blocked' }
    if (dependentTables[child]) {
      const owned = await db.from(child).select('id').eq('org_id', orgId).in(column, ids)
      if (owned.error) return { status: 500, code: 'TENANT_LOOKUP_FAILED', error: 'Dependency lookup failed' }
      if (owned.data?.length) {
        const denied = await checkTenantDeletion(db, orgId, child, owned.data.map(row => row.id as string))
        if (denied) return denied
      }
    }
  }
  return null
}

