import { getSupabaseAdmin } from '../../config/supabase.js'
import { ConfigError, databaseError } from '../config/AgentVersionService.js'
import { criteriaFromLegacy, propertySearchCriteriaSchema, type PropertySearchCriteria } from '../../properties/PropertySearchCriteria.js'

export interface ConversationState {
  conversationId: string
  contactId: string
  criteria: PropertySearchCriteria
  shownRefs: string[]
  language: 'en' | 'ar'
  revision: number
}
export class ConversationStateService {
  constructor(private readonly db = getSupabaseAdmin()) {}

  async read(orgId: string, conversationId: string, contactId?: string): Promise<ConversationState> {
    const parent = await this.db.from('conversations').select('contact_id').eq('org_id',orgId).eq('id',conversationId).maybeSingle()
    if (parent.error) throw databaseError(parent.error)
    if (!parent.data || (contactId && parent.data.contact_id !== contactId)) throw new ConfigError(404,'CONVERSATION_NOT_FOUND','Conversation was not found')
    const contact = await this.db.from('contacts').select('id,contact_memory,language').eq('org_id',orgId).eq('id',parent.data.contact_id).maybeSingle()
    if (contact.error) throw databaseError(contact.error)
    if (!contact.data) throw new ConfigError(404,'CONTACT_NOT_FOUND','Contact was not found')
    const current = await this.db.from('conversation_states').select('*').eq('org_id',orgId).eq('conversation_id',conversationId).maybeSingle()
    if (current.error) throw databaseError(current.error)
    if (current.data) {
      if (current.data.contact_id !== parent.data.contact_id || current.data.schema_version !== 1) throw new ConfigError(500,'INVALID_STATE','Conversation state is invalid')
      const criteria=propertySearchCriteriaSchema.safeParse(current.data.criteria)
      if(!criteria.success)throw new ConfigError(500,'INVALID_STATE','Stored conversation criteria are invalid')
      return { conversationId, contactId: contact.data.id, criteria: criteria.data,
        shownRefs: current.data.shown_property_refs, language: current.data.language, revision: current.data.revision }
    }
    const legacy = await this.db.from('contact_memory').select('key,value').eq('contact_id',contact.data.id)
    if (legacy.error) throw databaseError(legacy.error)
    const parsed = Object.fromEntries((legacy.data ?? []).map(row => [row.key, /^(?:\d+)(?:\.\d+)?$/.test(row.value) ? Number(row.value) : row.value === 'true' ? true : row.value === 'false' ? false : row.value]))
    // Null/empty compatibility values do not override valid older JSON values.
    const criteria = criteriaFromLegacy({ ...contact.data.contact_memory, ...Object.fromEntries(Object.entries(parsed).filter(([,value]) => value !== '')) })
    return { conversationId, contactId: contact.data.id, criteria, shownRefs: criteria.excludeRefs, language: contact.data.language, revision: 0 }
  }

  async save(orgId: string, previous: ConversationState, criteria: PropertySearchCriteria, shownRefs: string[], language: 'en' | 'ar'): Promise<void> {
    const validated = propertySearchCriteriaSchema.parse(criteria)
    const result = await this.db.rpc('save_conversation_state', { p_org_id:orgId,p_conversation_id:previous.conversationId,p_contact_id:previous.contactId,
      p_expected_revision:previous.revision,p_criteria:validated,p_shown_refs:shownRefs,p_language:language })
    if (result.error) throw databaseError(result.error)
  }
}
