import { beforeEach,describe,expect,it,vi } from 'vitest'
import { fakeSupabase } from '../support/fake-supabase'
import { structuredIntentClassifier,extractBudgetBounds } from '../../backend/src/modules/ai/StructuredIntentClassifier'
import { propertySearchCriteriaSchema,criteriaFromLegacy } from '../../backend/src/properties/PropertySearchCriteria'
import { PropertyMatcher } from '../../backend/src/properties/PropertyMatcher'
import { PropertyMediaService,formatVerifiedProperties,safePropertyMediaUrl } from '../../backend/src/properties/PropertyMediaService'
const db=vi.hoisted(()=>({ current:null as any }))
vi.mock('../../backend/src/config/supabase',()=>({ getSupabaseAdmin:()=>db.current,isSupabaseConfigured:()=>true }))
const row=(ref:string,overrides:Record<string,unknown>={})=>({ id:ref,org_id:'a',ref,ref_number:ref+'-ALIAS',available:true,type:'apartment',category:'sale',transaction_type:'SALE',district:'Dubai Marina',bedrooms:'2',price_aed:1e6,source:'direct',project:'Harbour',building:'Tower One',developer:'Builder',status:'ready',image_urls:[],...overrides })
beforeEach(()=>{ db.current=fakeSupabase({ properties:[...Array.from({length:7},(_,i)=>row('REF-'+(i+1),{ price_aed:1e6+i*1e5 })),row('REF-V',{ type:'villa' }),row('REF-B',{ org_id:'b',price_aed:1 }),row('REF-I',{ source:'indirect',price_aed:3e6 })] }) })
describe('structured English, Arabic and mixed criteria',()=>{
  it.each([
    ['I need to buy a 2BR apartment in Marina under AED 2M',{ area:'Dubai Marina',bedrooms:'2',propertyType:'apartment',transactionType:'SALE',maxPrice:2e6 }],
    ['أريد شراء شقة غرفتين في دبي مارينا بميزانية أقل من ٢ مليون درهم',{ area:'Dubai Marina',bedrooms:'2',propertyType:'apartment',transactionType:'SALE',maxPrice:2e6 }],
    ['شقة 2BR في Marina للإيجار أقل من ١٢٠ ألف',{ area:'Dubai Marina',bedrooms:'2',propertyType:'apartment',transactionType:'RENT',maxPrice:120000 }],
    ['villa project: "Harbour"; building: "Tower One"; developer: Builder',{ propertyType:'villa',project:'Harbour',building:'Tower One',developer:'Builder' }],
    ['مرجع REF-123',{ referenceNumber:'REF-123' }],['reference: ABC',{ referenceNumber:'ABC' }],
    ['Send property A/UNIT-101',{referenceNumber:'A/UNIT-101'}],['reference: "AB C/1"',{referenceNumber:'AB C/1'}],
    ['Studio in JVC',{ propertyType:'apartment',bedrooms:'Studio',area:'JVC' }],
  ])('extracts %s',(message,expected)=>expect(structuredIntentClassifier.classify(message).patch).toMatchObject(expected))
  it.each([['between 1 and 2 million',{minPrice:1e6,maxPrice:2e6}],['من ١ مليون إلى ٢ مليون',{minPrice:1e6,maxPrice:2e6}],['at least AED 750k',{minPrice:750000}],['Max 2 million',{maxPrice:2e6}],['1,900,000',{maxPrice:1900000}],['2BR',{ }]])('extracts bounded budget from %s',(message,expected)=>expect(extractBudgetBounds(message)).toEqual(expected))
  it('merges a budget and more without losing the current area or bedrooms',()=>{
    let criteria=propertySearchCriteriaSchema.parse({area:'Dubai Marina',bedrooms:'2',excludeRefs:['REF-1']})
    criteria=structuredIntentClassifier.merge(structuredIntentClassifier.classify('Max 2 million',criteria),criteria)
    expect(structuredIntentClassifier.merge(structuredIntentClassifier.classify('Show me more',criteria),criteria)).toEqual({area:'Dubai Marina',bedrooms:'2',maxPrice:2e6,excludeRefs:['REF-1']})
  })
  it('clears the selected reference for alternatives and retains it for more details',()=>{
    const criteria=propertySearchCriteriaSchema.parse({referenceNumber:'REF-1',area:'Dubai Marina',bedrooms:'2',excludeRefs:['REF-1']})
    expect(structuredIntentClassifier.merge(structuredIntentClassifier.classify('Show me more',criteria),criteria).referenceNumber).toBeUndefined()
    expect(structuredIntentClassifier.merge(structuredIntentClassifier.classify('more details',criteria),criteria).referenceNumber).toBe('REF-1')
  })
  it('keeps transaction category separate from property type at the compatibility boundary',()=>expect(criteriaFromLegacy({category:'villa',transactionType:'SALE',maxBudget:'2000000',bedrooms:2})).toMatchObject({propertyType:'villa',transactionType:'SALE',maxPrice:2e6,bedrooms:'2'}))
  it('rejects invalid bounds and unknown organization criteria',()=>{
    expect(propertySearchCriteriaSchema.safeParse({minPrice:2,maxPrice:1}).success).toBe(false)
    expect(propertySearchCriteriaSchema.safeParse({orgId:'b'}).success).toBe(false)
  })
})
describe('verified matching and identity',()=>{
  it.each(['REF-2','ref-2','REF-2-ALIAS'])('resolves exact reference %s without location clarification',async referenceNumber=>{
    const result=await new PropertyMatcher().searchCanonical('a',{referenceNumber,excludeRefs:[]})
    expect(result.properties.map(p=>p.ref)).toEqual(['REF-2']);expect(result.trace).toEqual(['exact_reference'])
  })
  it('never substitutes another listing for an unknown or foreign reference',async()=>{
    for(const referenceNumber of ['REF-404','REF-B']) expect((await new PropertyMatcher().searchCanonical('a',{referenceNumber,excludeRefs:[]})).properties).toEqual([])
  })
  it('refuses ambiguous aliases and unavailable exact identities',async()=>{
    db.current.tables.properties.push(row('REF-D',{ref_number:'REF-2'}))
    expect((await new PropertyMatcher().searchCanonical('a',{referenceNumber:'REF-2',excludeRefs:[]})).reason).toBe('ambiguous_reference')
    db.current.tables.properties[0].available=false
    expect((await new PropertyMatcher().searchCanonical('a',{referenceNumber:'REF-1',excludeRefs:[]})).reason).toBe('reference_unavailable')
  })
  it('excludes both aliases before limiting and never repeats when alternatives exist',async()=>{
    const matcher=new PropertyMatcher(),criteria=propertySearchCriteriaSchema.parse({area:'Marina',bedrooms:'2',propertyType:'apartment',maxPrice:2e6})
    const first=await matcher.searchCanonical('a',criteria)
    const second=await matcher.searchCanonical('a',{...criteria,excludeRefs:first.properties.map(p=>p.ref_number!)})
    expect(first.properties.map(p=>p.ref)).toEqual(['REF-1','REF-2','REF-3'])
    expect(second.properties.map(p=>p.ref)).toEqual(['REF-4','REF-5','REF-6'])
  })
  it.each([{propertyType:'villa'},{project:'Different'},{building:'Tower'},{developer:'Different'},{bedrooms:'3'},{status:'off-plan'},{maxPrice:0},{distressOnly:true}])('enforces the explicit constraint %j',async patch=>{
    const result=await new PropertyMatcher().searchCanonical('a',propertySearchCriteriaSchema.parse(patch))
    expect(result.properties.map(p=>p.ref)).toEqual(patch.propertyType==='villa'?['REF-V']:[])
  })
  it('applies relaxation only under an approved bounded policy and labels it partial',async()=>{
    const matcher=new PropertyMatcher(),criteria=propertySearchCriteriaSchema.parse({propertyType:'apartment',maxPrice:950000})
    expect((await matcher.searchCanonical('a',criteria)).properties).toEqual([])
    expect((await matcher.searchCanonical('a',criteria,3,{approved:false,maxPricePercent:10})).properties).toEqual([])
    expect((await matcher.searchCanonical('a',criteria,3,{approved:true,maxPricePercent:10}))).toMatchObject({matchQuality:'partial',relaxedFields:['maxPrice']})
  })
  it('reads current prices and availability without stale cache',async()=>{
    const matcher=new PropertyMatcher()
    await matcher.searchCanonical('a',{referenceNumber:'REF-1',excludeRefs:[]})
    db.current.tables.properties[0].price_aed=42
    expect((await matcher.searchCanonical('a',{referenceNumber:'REF-1',excludeRefs:[]})).properties[0].price_aed).toBe(42)
  })
  it('rejects foreign inventory-gap parents before any compatibility write',async()=>{
    db.current.tables.contacts=[{id:'foreign',org_id:'b'},{id:'owned',org_id:'a'}]
    db.current.tables.conversations=[{id:'malformed',org_id:'a',contact_id:'foreign'}]
    const matcher=new PropertyMatcher(),base={orgId:'a',query:{orgId:'a'},directCount:0,indirectCount:0,usedFallback:false}
    await expect(matcher.logInventoryGap({...base,contactId:'foreign'})).rejects.toThrow('not found')
    await expect(matcher.logInventoryGap({...base,conversationId:'malformed'})).rejects.toThrow('not found')
    expect(db.current.tables.inventory_gaps ?? []).toEqual([])
  })
  it('preserves tenant-owned inventory-gap logging',async()=>{
    db.current.tables.contacts=[{id:'owned',org_id:'a'}];db.current.tables.conversations=[{id:'owned-conversation',org_id:'a',contact_id:'owned'}]
    await new PropertyMatcher().logInventoryGap({orgId:'a',contactId:'owned',conversationId:'owned-conversation',query:{orgId:'a',area:'Dubai Marina',maxPrice:1e6,transactionType:'SALE'},directCount:0,indirectCount:0,usedFallback:false})
    expect(db.current.tables.inventory_gaps).toHaveLength(1);expect(db.current.tables.inventory_gaps[0]).toMatchObject({org_id:'a',contact_id:'owned',conversation_id:'owned-conversation',area:'Dubai Marina',budget_max:1e6})
  })
})
describe('factual formatting and media',()=>{
  it('omits missing bedrooms, transaction, area and agent instead of inventing facts',()=>{
    const text=formatVerifiedProperties([{ref:'EMPTY',price_aed:0}], 'en')
    expect(text).toContain('AED 0');expect(text).toContain('Ref: EMPTY')
    for(const word of ['Studio','Dubai','For sale','Team','Agent:','Bedrooms:'])expect(text).not.toContain(word)
    expect(formatVerifiedProperties([{ref:'EMPTY',price_aed:0}],'ar')).not.toContain('ابتداءً')
  })
  it.each(['javascript:alert(1)','http://cdn.example.invalid/a','https://127.0.0.1/a','https://10.0.0.1/a','https://user:pass@cdn.example.invalid/a','https://private.local/a','https://localhost./a','https://[::1]/a'])('rejects unsafe media URL %s',url=>expect(safePropertyMediaUrl(url)).toBe(false))
  it('checks the owned parent and filters unsafe media without outbound requests',async()=>{
    db.current.tables.properties[0].image_urls=['https://cdn.example.invalid/photo.jpg','javascript:alert(1)']
    db.current.tables.property_media=[{org_id:'b',property_id:'REF-1',url:'https://b.example.invalid/secret',media_type:'image',position:0}]
    expect(await new PropertyMediaService().list('a','REF-1')).toEqual([{url:'https://cdn.example.invalid/photo.jpg',media_type:'image',position:0}])
    await expect(new PropertyMediaService().list('a','REF-B')).rejects.toMatchObject({status:404})
  })
})
