import { fakeSupabase } from './fake-supabase'

// A narrow transport dependency double. PostgreSQL tests independently verify the RPCs.
export function transportDb(seed: Record<string, any[]> = {}) {
  const db = fakeSupabase(seed)
  const tables = db.tables
  tables.messages ??= []
  tables.contacts ??= []
  tables.conversations ??= []
  const receipts = new Set<string>()
  let sequence = 0
  const rpc = async (name: string, p: any) => {
    if(name==='transition_handoff'){
      const c=tables.conversations.find(r=>r.id===p.p_conversation_id&&r.org_id===p.p_org_id)
      if(!c)return {data:null,error:{code:'PT404'}}
      tables.handoff_events??=[]
      if(p.p_action==='request'&&(!c.handoff_state||c.handoff_state==='AI_ACTIVE')){
        tables.handoff_events.push({id:'handoff-'+(++sequence),org_id:p.p_org_id,conversation_id:c.id,from_state:'AI_ACTIVE',to_state:'HANDOFF_REQUESTED'})
        Object.assign(c,{handoff_state:'HANDOFF_REQUESTED',handled_by:'human'})
      }
      return {data:structuredClone(c),error:null}
    }
    const m = tables.messages.find(r => r.id === p.p_message_id && r.org_id === p.p_org_id && r.device_id === p.p_device_id)
    if (name === 'receive_whatsapp_message') {
      const identity = [p.p_org_id,p.p_device_id,p.p_wa_message_id].join(':')
      const existing = tables.messages.find(r => r.org_id === p.p_org_id && r.device_id === p.p_device_id && r.wa_message_id === p.p_wa_message_id && r.direction === 'inbound')
      if (receipts.has(identity)) return {data: existing ?? {id:'removed',org_id:p.p_org_id,device_id:p.p_device_id},error:null}
      receipts.add(identity)
      let contact = tables.contacts.find(r => r.org_id === p.p_org_id && r.phone === p.p_phone)
      if (!contact) { contact = {id:'contact-'+(++sequence),org_id:p.p_org_id,phone:p.p_phone,language:'en',contact_memory:{}}; tables.contacts.push(contact) }
      let conversation = tables.conversations.find(r => r.org_id === p.p_org_id && r.contact_id === contact.id)
      if (!conversation) { conversation = {id:'conversation-'+(++sequence),org_id:p.p_org_id,contact_id:contact.id,status:'active'};tables.conversations.push(conversation) }
      const row = {id:'inbound-'+(++sequence),org_id:p.p_org_id,device_id:p.p_device_id,conversation_id:conversation.id,direction:'inbound',content:p.p_content,message_type:p.p_type,wa_message_id:p.p_wa_message_id,processing_status:'received',metadata:{replyJid:p.p_jid}}
      tables.messages.push(row); return {data:structuredClone(row),error:null}
    }
    if (name === 'claim_whatsapp_execution' || name === 'claim_whatsapp_send') {
      const expected = name === 'claim_whatsapp_execution' ? 'received' : 'prepared'
      if (!m || m.processing_status !== expected) return {data:null,error:null}
      Object.assign(m,{processing_status:expected === 'received'?'processing':'sending',claim_token:p.p_token})
      return {data:structuredClone(m),error:null}
    }
    if (name === 'prepare_whatsapp_response') {
      const existing = tables.messages.find(r => r.reply_to_message_id === m?.id)
      if(existing)return {data:structuredClone(existing),error:null}
      if (!m || m.processing_status !== 'processing' || m.claim_token !== p.p_token) return {data:null,error:{code:'PT409'}}
      const row = {...m,id:'outbound-'+(++sequence),direction:'outbound',reply_to_message_id:m.id,content:p.p_text,wa_message_id:p.p_outbound_wa_id,status:'failed',processing_status:'prepared',metadata:{...p.p_metadata,replyJid:m.metadata.replyJid}}
      tables.messages.push(row);m.processing_status='prepared';return {data:structuredClone(row),error:null}
    }
    if (!m || m.claim_token !== p.p_token) return {data:false,error:null}
    if (name === 'finish_whatsapp_send' && m.processing_status === 'sending') {
      const status = p.p_success?'completed':'needs_review'
      Object.assign(m,{processing_status:status,status:p.p_success?'sent':'failed',failure_code:p.p_failure_code})
      const parent=tables.messages.find(r=>r.id===m.reply_to_message_id);if(parent)Object.assign(parent,{processing_status:status,failure_code:p.p_failure_code})
      return {data:true,error:null}
    }
    if(name==='stop_whatsapp_execution' && m.processing_status==='processing'){
      Object.assign(m,{processing_status:p.p_ignored?'ignored':'needs_review',failure_code:p.p_failure_code});return {data:true,error:null}
    }
    return {data:false,error:null}
  }
  return {...db,rpc}
}
