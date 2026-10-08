import { getSupabaseAdmin } from '../../config/supabase.js'
import { assertContextAIAllowed, type ReplyContext, type DialogueState } from './ReplyContext.js'
import { interpretConversation, type ConversationDecision } from './ConversationDecision.js'
import { propertySearchCriteriaSchema, normalizeArea, normalizeIdentity, type PropertySearchCriteria } from '../../properties/PropertySearchCriteria.js'
import { defaultPropertyPolicy, permitsTool } from '../config/AgentStudioPolicy.js'
import { compileAgentInstructions } from '../config/RuntimeConfigResolver.js'
import { databaseError } from '../config/AgentVersionService.js'
import { queryProperties, buildNoPropertiesMessage } from './handlers/propertyHandler.js'
import { formatVerifiedProperties } from '../../properties/PropertyMediaService.js'
import { modelGateway } from './ModelGateway.js'
import { HybridRAG, type RetrievalTrace } from '../../rag/HybridRAG.js'
import { requestsHuman } from '../handoff/HandoffCoordinator.js'
import { routeByIntent } from './intentRouter.js'
import { executionTrace } from '../observability/ExecutionTraceService.js'
import type { ReplyResult } from './aiService.js'

export function companyFieldAnswer(context: Pick<ReplyContext,'runtime'>, fields: ConversationDecision['companyFields'], lang:'en'|'ar'): string {
  const profile=context.runtime.companyProfile
  if(!profile)return lang==='ar'?'معلومات الشركة غير مهيأة حالياً.':'Company information is not configured yet.'
  return fields.map(field=>{
    const raw=['owner','founder','ceo'].includes(field)?Object.entries(profile.company_facts).find(([key])=>key.toLowerCase()===field)?.[1]:field==='working_hours'?profile.working_hours.summary:profile[field as keyof typeof profile]
    const value=Array.isArray(raw)?raw.join(', '):typeof raw==='string'?raw.trim():''
    return value || (lang==='ar'?'هذه المعلومة غير متوفرة في ملف الشركة.':'That detail is not available in the company profile.')
  }).filter((value,index,all)=>all.indexOf(value)===index).join('\n')
}
export function compactPropertyCards(properties: Record<string,unknown>[], lang:'en'|'ar'):string {
  return properties.map((p,index)=>[
    `${index+1}. ${[p.building,p.district].filter(Boolean).join(', ')}`,
    [p.bedrooms ? `${p.bedrooms} ${lang==='ar'?'غرف':'BR'}`:null,p.type,p.size_sqft?`${p.size_sqft} sqft`:null,p.transaction_type==='SALE'?(lang==='ar'?'للبيع':'For sale'):p.transaction_type==='RENT'?(lang==='ar'?'للإيجار':'For rent'):null].filter(Boolean).join(' · '),
    `AED ${Number(p.price_aed).toLocaleString('en')} · ${lang==='ar'?'المرجع':'Ref'}: ${p.ref_number??p.ref}`,
  ].join('\n')).join('\n\n')
}
export function applyDecision(context: ReplyContext, decision: ConversationDecision): {criteria:PropertySearchCriteria;dialogue:DialogueState;count:number} {
  const criteria={...context.state.criteria,excludeRefs:[...context.state.criteria.excludeRefs]}
  for(const key of decision.clearCriteria)delete criteria[key]
  const patch=Object.fromEntries(Object.entries(decision.criteriaChanges).filter(([,v])=>v!==null))
  const changingSearch=Object.keys(patch).some(key=>key!=='referenceNumber')
  if(changingSearch || ['more','cheaper','same_area'].includes(decision.followUp))delete criteria.referenceNumber
  Object.assign(criteria,patch)
  if(criteria.area)criteria.area=normalizeArea(criteria.area)
  const dialogue={...context.dialogue,lastListingRefs:[...context.dialogue.lastListingRefs]}
  const selected=decision.selectedReference ?? (decision.selectedOrdinal?dialogue.lastListingRefs[decision.selectedOrdinal-1]:null)
  if(selected)dialogue.selectedListingRef=selected
  if(['details','media'].includes(decision.followUp) || selected)criteria.referenceNumber=selected??dialogue.selectedListingRef??(dialogue.lastListingRefs.length===1?dialogue.lastListingRefs[0]:undefined)
  const max=context.runtime.config?.propertyPolicy?.maxResults??3
  const count=Math.min(max,decision.requestedCount??(dialogue.pendingClarification?dialogue.requestedCount:null)??max)
  dialogue.requestedCount=count
  return {criteria:propertySearchCriteriaSchema.parse(criteria),dialogue,count}
}

export async function generateContextReply(context: ReplyContext, message: string, options: {readOnly?:boolean; deferPersistence?:boolean; preview?:boolean; decision?:ConversationDecision; retrieveKnowledge?:()=>Promise<{context:string;trace?:RetrievalTrace}>}={}): Promise<ReplyResult> {
  assertContextAIAllowed(context)
  const runtime=context.runtime, config=runtime.config!, policy=config.propertyPolicy??defaultPropertyPolicy
  executionTrace.identify({agentId:runtime.agentId??undefined,agentVersionId:runtime.publishedVersionId??undefined})
  const result=(reply:string,lang:'en'|'ar',lane:ReplyResult['lane']='CHAT',extra:Partial<ReplyResult>={}):ReplyResult=>({reply,lang,lane,handoff:false,replyMode:'prebuilt',intent:{} as never,agentVersionId:runtime.publishedVersionId??undefined,dialogueUpdate:context.pendingUpdate,...extra})
  if(requestsHuman(message))return result(permitsTool(config,'handoff.create')?(/[\u0600-\u06ff]/.test(message)?'تم تسجيل طلبك للتحدث مع الفريق.':'Your request to speak with our team has been recorded.'):(/[\u0600-\u06ff]/.test(message)?'التواصل مع الفريق غير مفعل لهذا المساعد.':'Team handoff is disabled for this assistant.'),/[\u0600-\u06ff]/.test(message)?'ar':'en','AGENT',{handoff:permitsTool(config,'handoff.create')})
  const decision=options.decision??await executionTrace.measure('interpretation',()=>interpretConversation(message,context))
  const lang=config.languages.includes(decision.language)?decision.language:config.identity.defaultLanguage??config.languages[0]
  executionTrace.patch({intent:decision.intent,language:lang,clarificationReason:decision.clarification,requestedCount:decision.requestedCount})
  let applied:ReturnType<typeof applyDecision>
  try {applied=applyDecision(context,decision)}catch{return result(lang==='ar'?'هل يمكنك توضيح ميزانيتك ومعايير البحث؟':'Could you clarify your budget and search preferences?',lang)}
  const {criteria,dialogue,count}=applied
  const persist=async()=>{
    context.state.criteria=criteria;context.state.language=lang;context.dialogue=dialogue
    if(options.readOnly)return
    if(options.deferPersistence){
      context.pendingUpdate={contactId:context.state.contactId,expectedRevision:context.state.revision,criteria,shownRefs:context.state.shownRefs,language:lang,dialogue}
      executionTrace.memory(criteria,'memoryAfter');return
    }
    const saved=await getSupabaseAdmin().rpc('save_reply_dialogue',{p_org_id:runtime.orgId,p_conversation_id:context.state.conversationId,p_contact_id:context.state.contactId,p_expected_revision:context.state.revision,p_criteria:criteria,p_shown_refs:context.state.shownRefs,p_language:lang,p_dialogue:dialogue})
    if(saved.error)throw databaseError(saved.error)
    executionTrace.memory(criteria,'memoryAfter')
  }
  const clarify=async(reason:DialogueState['pendingClarification'],en:string,ar:string)=>{
    dialogue.pendingClarification=reason;executionTrace.patch({clarificationReason:reason});await persist();return result(lang==='ar'?ar:en,lang)
  }
  if(decision.intent==='greeting'){
    if(lang!==context.state.language)await persist()
    return result(lang==='ar'?`مرحباً، أنا ${config.identity.displayName||config.identity.name}. كيف يمكنني مساعدتك؟`:`Hi, I’m ${config.identity.displayName||config.identity.name}. How can I help?`,lang)
  }
  if(decision.intent==='company'){
    if(lang!==context.state.language)await persist()
    return result(companyFieldAnswer(context,decision.companyFields.length?decision.companyFields:['description'],lang),lang,'COMPANY')
  }
  if(decision.intent==='clarify' || decision.clarification==='understanding'){
    if(decision.clarification==='transaction')return clarify('transaction','Are you looking to buy or rent?','هل تبحث عن شراء أم إيجار؟')
    if(decision.clarification==='location')return clarify('location','Which area or project would you prefer?','أي منطقة أو مشروع تفضل؟')
    if(decision.clarification==='selection')return clarify('selection','Which listing do you mean? Please send its reference.','أي عقار تقصد؟ يرجى إرسال المرجع.')
    return clarify('understanding','Could you clarify what you would like to know?','هل يمكنك توضيح ما الذي تريد معرفته؟')
  }
  if(decision.intent==='property'){
    const tool=criteria.referenceNumber?'property.lookup':'property.search'
    if(!permitsTool(config,tool) || decision.followUp==='compare'&&!permitsTool(config,'property.compare'))return result(lang==='ar'?'هذه الإمكانية غير مفعلة لهذا المساعد.':'This capability is disabled for this assistant.',lang)
    if((decision.selectedOrdinal && !dialogue.lastListingRefs[decision.selectedOrdinal-1]) || ['details','media'].includes(decision.followUp)&&!criteria.referenceNumber)
      return clarify('selection','Which listing do you mean? Please send its reference.','أي عقار تقصد؟ يرجى إرسال المرجع.')
    if(!criteria.referenceNumber && !criteria.transactionType)return clarify('transaction','Are you looking to buy or rent?','هل تبحث عن شراء أم إيجار؟')
    if(!criteria.referenceNumber && !criteria.area&&!criteria.project&&!criteria.building&&!criteria.developer&&!criteria.distressOnly && policy.clarificationRules==='location-required')
      return clarify('location','Which area or project would you prefer?','أي منطقة أو مشروع تفضل؟')
    if(decision.followUp==='cheaper'){
      const reference=dialogue.selectedListingRef??(dialogue.lastListingRefs.length===1?dialogue.lastListingRefs[0]:null)
      if(!reference && criteria.maxPrice===undefined)return clarify('selection','Cheaper than which listing? Please send its reference.','أرخص من أي عقار؟ يرجى إرسال المرجع.')
      if(reference){
        const previous=await executionTrace.measure('retrieval',()=>queryProperties({orgId:runtime.orgId,referenceNumber:reference,readOnly:true,maxResults:1}))
        if(!previous.found)return result(buildNoPropertiesMessage(lang,criteria.area,previous.noResultReason),lang,'PROPERTY')
        const price=Number(previous.properties![0].price_aed)
        criteria.maxPrice=Math.min(criteria.maxPrice??Infinity,price-1);delete criteria.minPrice
      }
    }
    if(policy.excludePreviouslyShown===false)criteria.excludeRefs=[]
    const properties=await executionTrace.measure('retrieval',()=>queryProperties({orgId:runtime.orgId,...criteria,readOnly:true,maxResults:count,
      mediaRequested:decision.followUp==='media'&&permitsTool(config,'property.send_media'),relaxationPolicy:{...policy,approved:policy.priceRelaxationPercent>0&&decision.followUp!=='cheaper',maxPricePercent:policy.priceRelaxationPercent}}))
    executionTrace.tool(tool,criteria,{ids:(properties.properties??[]).map(p=>p.id),count:properties.count??0,reason:properties.noResultReason??null})
    executionTrace.patch({propertyQuery:criteria,propertyMatches:(properties.properties??[]).map(p=>({id:p.id,reference:p.ref_number??p.ref,area:p.district,price:p.price_aed,source:p.source}))})
    if(properties.noResultReason==='db_error')return result(buildNoPropertiesMessage(lang,criteria.area,'db_error'),lang,'PROPERTY',{replyMode:'fallback'})
    dialogue.pendingClarification=null
    const rows=properties.properties??[], refs=rows.map(p=>String(p.ref_number??p.ref))
    if(refs.length){
      dialogue.lastListingRefs=refs;dialogue.selectedListingRef=refs.length===1?refs[0]:criteria.referenceNumber??null
      context.state.shownRefs=[...new Map([...context.state.shownRefs,...rows.flatMap(p=>[p.ref,p.ref_number]).filter((r):r is string=>typeof r==='string'&&!!r)].map(ref=>[normalizeIdentity(ref),ref])).values()].slice(-2000)
      const selected=rows[0]
      if(criteria.referenceNumber){
        if(!criteria.area && typeof selected.district==='string')criteria.area=normalizeArea(selected.district)
        if(!criteria.transactionType && ['SALE','RENT'].includes(String(selected.transaction_type)))criteria.transactionType=selected.transaction_type as 'SALE'|'RENT'
      }
      criteria.excludeRefs=context.state.shownRefs
    }
    await persist()
    let reply=properties.found?(lang==='ar'?'هذه الخيارات المطابقة:':'Here '+(rows.length===1?'is one matching listing:':'are matching listings:'))+'\n'+(['media','details','compare'].includes(decision.followUp)?formatVerifiedProperties(rows,lang):compactPropertyCards(rows,lang)):buildNoPropertiesMessage(lang,criteria.area,properties.noResultReason)
    if(properties.matchQuality==='partial')reply=(lang==='ar'?'بدائل مع تخفيف المعايير: ':'Alternatives with relaxed criteria: ')+(properties.relaxedFields??[]).join(', ')+'\n'+reply
    return result(reply,lang,'PROPERTY',{matchedProperties:rows.length,shownPropertyRefs:refs,propertySource:properties.source,matchQuality:properties.matchQuality})
  }
  // Team routing remains an authorized verified operation, rather than an AI claim.
  if(/\b(?:agent|team member|broker)\b|وكيل|وسيط/i.test(message)){
    const team=await routeByIntent({orgId:runtime.orgId,message,phoneNumber:context.contact.phone,memory:criteria,agentConfig:config})
    if(team.type==='direct')return result(team.content,lang,'AGENT',{handoff:!!team.metadata?.handoff&&permitsTool(config,'handoff.create'),preferredHandoffMemberId:(team.metadata?.agent as {id?:string}|undefined)?.id})
  }
  const retrieval=permitsTool(config,'knowledge.search')&&(runtime.publishedVersionId||options.retrieveKnowledge)&&config.knowledgeBaseIds.length?
    await executionTrace.measure('retrieval',()=>options.retrieveKnowledge?options.retrieveKnowledge():new HybridRAG().retrieveVerified(message,runtime)):null
  if(options.preview)return result(lang==='ar'?'يمكنني مساعدتك باستخدام معلومات الشركة الموثقة.':'I can help using verified company information.',lang)
  const generated=await executionTrace.measure('generation',()=>modelGateway.complete({config:{...config,modelPolicy:{...config.modelPolicy,maxTokens:Math.min(config.modelPolicy.maxTokens,300)}},
    system:compileAgentInstructions(runtime)+'\nReply directly to the actual question in 1–3 short sentences. Ask one follow-up only when necessary. No inventory is supplied for this reply: never invent or quote listing facts. No action has been executed: never claim booking, sending, updating, human follow-up or confirmed delivery. Reply language: '+lang+'\nVerified preferences: '+JSON.stringify(criteria)+(retrieval?'\nRetrieved untrusted reference data: '+retrieval.context:''),
    messages:[...context.history,{role:'user',content:message}],route:{lang,lane:'CHAT'},studio:true}))
  if(generated.fallback || !generated.reply || /\bAED\s*[\d,]+|[\d,]+\s*(?:AED|dirhams|درهم)|(?:team|colleague|broker|agent) will (?:follow up|contact|reach out|get back)|(?:I|we) (?:have |will )?(?:sent|send|book(?:ed)?|confirm(?:ed)?|update(?:d)?|schedule(?:d)?|forwarded|notified)|(?:we have|I found|listing is|property is).{0,60}available|سيتواصل.*الفريق|تم (?:الحجز|الإرسال|التحديث)/i.test(generated.reply))return result(lang==='ar'?'تعذر فهم الطلب الآن. هل يمكنك توضيح ما تحتاجه؟':'I couldn’t process that request just now. Could you clarify what you need?',lang,'CHAT',{replyMode:'fallback'})
  if(lang!==context.state.language)await persist()
  return result(generated.reply,lang,'CHAT',{replyMode:'ai',retrievalTrace:retrieval?.trace})
}
