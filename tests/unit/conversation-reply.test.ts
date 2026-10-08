import { afterEach, expect, it, vi } from 'vitest'
import { defaultAgentConfig, agentVersionService } from '../../backend/src/modules/config/AgentVersionService'
import { runtimeConfigResolver } from '../../backend/src/modules/config/RuntimeConfigResolver'
import { mandatoryStudioChecks } from '../../backend/src/modules/config/StudioPlayground'
import { directDecision, decisionSchema, interpretConversation, requestedResultCount } from '../../backend/src/modules/ai/ConversationDecision'
import { applyDecision, companyFieldAnswer, compactPropertyCards, generateContextReply } from '../../backend/src/modules/ai/ConversationReplyEngine'
import { dialogueSchema, type ReplyContext } from '../../backend/src/modules/ai/ReplyContext'
import { modelGateway } from '../../backend/src/modules/ai/ModelGateway'

const context=():ReplyContext=>({runtime:{orgId:'a',deviceId:'d',agentId:'agent',publishedVersionId:'version',versionNumber:1,config:defaultAgentConfig('SARA'),companyConfigured:true,
  companyProfile:{office_address:'Office 42, Dubai',map_url:'https://example.invalid/map',description:'Full company profile',working_hours:{summary:'9–6'},company_facts:{},legal_name:'Company'} as never},
  conversation:{id:'conversation',org_id:'a',contact_id:'contact',handoff_state:'AI_ACTIVE',handled_by:'ai'},contact:{id:'contact',org_id:'a',phone:'',name:null,language:'en',contact_memory:{}},
  state:{conversationId:'conversation',contactId:'contact',criteria:{excludeRefs:[]},shownRefs:[],language:'en',revision:0},dialogue:dialogueSchema.parse({}),history:[]})
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks()})
it('answers the office address without the map or full profile',async()=>{
  const c=context(),decision=directDecision('What is your office address?',c)!
  expect(companyFieldAnswer(c,decision.companyFields,'en')).toBe('Office 42, Dubai')
  expect((await generateContextReply(c,'office address',{readOnly:true})).reply).toBe('Office 42, Dubai')
  expect(companyFieldAnswer(c,['map_url'],'en')).toBe('https://example.invalid/map')
})
it('is honest when the requested company field is missing',()=>expect(companyFieldAnswer(context(),['phone'],'en')).toBe('That detail is not available in the company profile.'))
it('recognizes requested one and bounds explicit counts by the published maximum',()=>{
  const c=context()
  for(const text of ['Hi send me one property in jlt','show me a single property in JVC','اعرض عقار واحد في JVC']){
    const d=directDecision(text,c)!
    expect(requestedResultCount(text)).toBe(1);expect(applyDecision(c,d).count).toBe(1)
  }
  expect(applyDecision(c,directDecision('show me 19 properties for rent in JVC',c)!).count).toBe(3)
})
it('retains area and result count while awaiting buy/rent',async()=>{
  const c=context(), d=directDecision('show me one property in JVC',c)!, first=applyDecision(c,d)
  expect(first.criteria).toMatchObject({area:'JVC'});expect(first.criteria.transactionType).toBeUndefined()
  expect((await generateContextReply(c,'show me one property in JVC',{readOnly:true})).reply).toBe('Are you looking to buy or rent?')
  c.state.criteria=first.criteria;c.dialogue={...first.dialogue,pendingClarification:'transaction'}
  const next=applyDecision(c,directDecision('rent',c)!)
  expect(next.criteria).toMatchObject({area:'JVC',transactionType:'RENT'});expect(next.count).toBe(1)
})
it('resolves ordinals against the last displayed batch, not all historical listings',()=>{
  const c=context();c.state.shownRefs=['old','A','B'];c.dialogue.lastListingRefs=['A','B']
  const d={...directDecision('hello',c)!,intent:'property' as const,selectedOrdinal:2,followUp:'details' as const}
  expect(applyDecision(c,d).criteria.referenceNumber).toBe('B')
})
it('explicit corrections replace preferences and clear stale reference selection',()=>{
  const c=context();c.state.criteria={area:'JVC',transactionType:'RENT',bedrooms:'2',maxPrice:100000,referenceNumber:'old',excludeRefs:[]}
  const d={...directDecision('hello',c)!,intent:'property' as const,criteriaChanges:{...directDecision('hello',c)!.criteriaChanges,transactionType:'SALE' as const,area:'JLT',maxPrice:2000000},clearCriteria:['bedrooms' as const]}
  const next=applyDecision(c,d).criteria
  expect(next).toMatchObject({area:'JLT',transactionType:'SALE',maxPrice:2000000});expect(next.bedrooms).toBeUndefined();expect(next.referenceNumber).toBeUndefined()
})
it('preserves Arabic for short follow-ups and renders only verified listing fields',()=>{
  const c=context();c.state.language='ar'
  expect(directDecision('rent',c)!.language).toBe('ar')
  const card=compactPropertyCards([{ref:'A',district:'JVC',price_aed:50000,transaction_type:'RENT'}],'en')
  expect(card).toContain('AED 50,000');expect(card).not.toMatch(/year|booking|sent|follow up|size on request|N\/A/i)
})
it('rejects injected organization IDs and malformed interpretation output',()=>{
  const d=directDecision('hello',context())!
  expect(decisionSchema.safeParse({...d,orgId:'foreign'}).success).toBe(false)
  expect(decisionSchema.safeParse({...d,requestedCount:10000}).success).toBe(false)
})
it('includes current input once, uses the published model, and refuses invented selected references',async()=>{
  const c=context();c.runtime.config!.modelPolicy.model='openai/gpt-oss-120b';c.history=[{role:'user',content:'show two'},{role:'assistant',content:'A and B'}];c.dialogue.lastListingRefs=['A','B']
  let body:any
  vi.stubEnv('GROQ_API_KEY','fixture-key')
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...directDecision('hello',c)!,intent:'property',selectedReference:'invented'})}}]}),{status:200})}))
  const result=await interpretConversation('the second one',c)
  expect(body.model).toBe('openai/gpt-oss-120b');expect(body.response_format.json_schema.strict).toBe(true)
  expect(body.messages.filter((m:any)=>m.content==='the second one')).toHaveLength(1)
  expect(result.intent).toBe('clarify');expect(result.clarification).toBe('selection')
})
it('does not execute under human ownership',async()=>{
  const c=context();c.conversation.handoff_state='HUMAN_ACTIVE'
  await expect(generateContextReply(c,'hello',{readOnly:true})).rejects.toMatchObject({code:'HUMAN_HANDOFF'})
})
it('advice questions that mention an apartment go through interpretation, rather than searching inventory',()=>{
 expect(directDecision('What should I consider before choosing an apartment?',context())).toBeNull()
 expect(directDecision('Is JVC a good area?',context())).toBeNull()
 expect(directDecision('show one available property in JVC',context())?.requestedCount).toBe(1)
 expect(directDecision('just one in JVC',context())?.requestedCount).toBe(1)
})
it('a rejected model action claim becomes an honest clarification in the real reply engine',async()=>{
 vi.spyOn(modelGateway,'complete').mockResolvedValue({reply:'This is a preview. No external action was performed.',provider:'groq',model:'fixture',attempts:[],fallback:true})
 const c=context(),decision={...directDecision('hello',c)!,intent:'general' as const}
 const reply=await generateContextReply(c,'please book it',{readOnly:true,decision})
 expect(reply.replyMode).toBe('fallback');expect(reply.reply).toContain('Could you clarify');expect(reply.reply).not.toContain('preview')
})
it('publication fixtures reuse the validated draft/profile and still reject a revision change',async()=>{
 const c=context(),draft={org_id:'a',agent_id:'agent',revision:1,config:c.runtime.config} as any
 const read=vi.spyOn(agentVersionService,'draft').mockResolvedValue(draft)
 const references=vi.spyOn(agentVersionService,'references').mockResolvedValue(undefined)
 const company=vi.spyOn(runtimeConfigResolver,'resolveCompany').mockResolvedValue({orgId:'a',companyProfile:c.runtime.companyProfile,companyConfigured:true})
 const checked=await mandatoryStudioChecks('a','agent',1,draft)
 expect(checked.tests.every(test=>test.passed)).toBe(true);expect(checked.providerCalls).toBe(0)
 expect(read).toHaveBeenCalledTimes(1);expect(references).toHaveBeenCalledTimes(1);expect(company).toHaveBeenCalledTimes(1)
 read.mockResolvedValue({...draft,revision:2})
 await expect(mandatoryStudioChecks('a','agent',1,draft)).rejects.toMatchObject({code:'DRAFT_CONFLICT'})
})
