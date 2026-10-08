import { getSupabaseAdmin, isSupabaseConfigured } from '../src/config/supabase.js'

type MatchQuality = 'exact' | 'partial' | 'none'
type MatchSource = 'direct' | 'indirect' | 'none'

function inferFromMessages(messages: Array<{ content: string; created_at: string }>): {
  sent: boolean
  quality: MatchQuality
  source: MatchSource
  sentAt: string | null
} {
  const joined = messages.map((m) => m.content ?? '').join('\n').toLowerCase()
  const sent = /🏠|\*property|\*العقار|would you like to arrange a viewing|want a viewing/i.test(joined)
  const partial = /similar|close alternatives|broaden|broaden the search|not exact match/i.test(joined)
  const source: MatchSource =
    /partner listing|partner network|partner market listings|شريك/.test(joined)
      ? 'indirect'
      : sent
        ? 'direct'
        : 'none'
  const quality: MatchQuality = sent ? (partial ? 'partial' : 'exact') : 'none'
  const sentAt = messages.length > 0 ? messages[0].created_at : null
  return { sent, quality, source, sentAt }
}

async function main(): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.error('Supabase is not configured')
    process.exit(1)
  }

  const apply = process.argv.includes('--apply')
  const supabase = getSupabaseAdmin()
  let offset = 0
  const pageSize = 200
  let examined = 0
  let wouldUpdate = 0
  let updated = 0

  while (true) {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, org_id, contact_memory')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!contacts || contacts.length === 0) break

    for (const contact of contacts) {
      examined += 1
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('org_id', contact.org_id)
        .eq('contact_id', contact.id)
        .order('updated_at', { ascending: false })
        .limit(5)

      const conversationIds = (conversations ?? []).map((c) => c.id)
      if (conversationIds.length === 0) continue

      const { data: messages } = await supabase
        .from('messages')
        .select('content, created_at')
        .in('conversation_id', conversationIds)
        .eq('direction', 'outbound')
        .eq('sender_type', 'ai')
        .order('created_at', { ascending: false })
        .limit(20)

      const inferred = inferFromMessages((messages ?? []) as Array<{ content: string; created_at: string }>)
      const current =
        contact.contact_memory && typeof contact.contact_memory === 'object'
          ? (contact.contact_memory as Record<string, unknown>)
          : {}

      const nextMemory = {
        ...current,
        last_property_sent: inferred.sent,
        last_match_quality: inferred.quality,
        last_match_source: inferred.source,
        last_properties_sent_count: inferred.sent ? String(Math.min((messages ?? []).length, 3)) : '0',
        last_property_sent_at: inferred.sentAt ?? current.last_property_sent_at ?? null,
      }

      const changed =
        current.last_property_sent !== nextMemory.last_property_sent ||
        current.last_match_quality !== nextMemory.last_match_quality ||
        current.last_match_source !== nextMemory.last_match_source ||
        current.last_properties_sent_count !== nextMemory.last_properties_sent_count

      if (!changed) continue
      wouldUpdate += 1

      if (apply) {
        const { error: updateError } = await supabase
          .from('contacts')
          .update({ contact_memory: nextMemory, updated_at: new Date().toISOString() })
          .eq('id', contact.id)
          .eq('org_id', contact.org_id)
        if (!updateError) updated += 1
      }
    }

    offset += contacts.length
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        examined,
        wouldUpdate,
        updated,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('Backfill failed:', error)
  process.exit(1)
})
