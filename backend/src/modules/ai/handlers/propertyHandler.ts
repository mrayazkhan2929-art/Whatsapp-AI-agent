import { PropertyMatcher, type PropertyRelaxationPolicy } from '../../../properties/PropertyMatcher.js'
import { propertySearchCriteriaSchema, type PropertySearchCriteria } from '../../../properties/PropertySearchCriteria.js'
import { PropertyMediaService } from '../../../properties/PropertyMediaService.js'

export interface PropertyQueryParams extends Partial<PropertySearchCriteria> {
  orgId: string
  contactId?: string
  conversationId?: string
  /** Compatibility input only. Canonical callers use propertyType/transactionType. */
  category?: string
  distressPreferred?: boolean
  mediaRequested?: boolean
  relaxationPolicy?: PropertyRelaxationPolicy
  maxResults?:number
  readOnly?:boolean
}
export interface PropertyHandlerResponse {
  found: boolean
  message: string
  properties?: Record<string,unknown>[]
  count?: number
  source?: 'direct'|'indirect'|'none'
  directCount?: number
  indirectCount?: number
  usedFallback?: boolean
  matchQuality?: 'exact'|'partial'|'none'
  noResultReason?: string
  trace?: string[]
  relaxedFields?: string[]
  criteria?: PropertySearchCriteria
}
const matcher = new PropertyMatcher()
export async function queryProperties(params: PropertyQueryParams): Promise<PropertyHandlerResponse> {
  const criteria = propertySearchCriteriaSchema.parse({ referenceNumber:params.referenceNumber,transactionType:params.transactionType ?? (params.category==='sale'?'SALE':params.category==='rent'?'RENT':undefined),
    propertyType:params.propertyType ?? (['apartment','villa','townhouse','penthouse'].includes(params.category ?? '')?params.category:undefined),
    area:params.area,project:params.project,building:params.building,bedrooms:params.bedrooms,minPrice:params.minPrice,maxPrice:params.maxPrice,status:params.status,
    developer:params.developer,distressOnly:params.distressOnly ?? params.distressPreferred,excludeRefs:params.excludeRefs ?? [] })
  try {
    const result = await matcher.searchCanonical(params.orgId,criteria,params.maxResults??3,params.relaxationPolicy)
    if(!params.readOnly&&!criteria.referenceNumber && result.directCount===0)await matcher.logInventoryGap({orgId:params.orgId,contactId:params.contactId,conversationId:params.conversationId,
      query:{orgId:params.orgId,area:criteria.area,bedrooms:criteria.bedrooms,minPrice:criteria.minPrice,maxPrice:criteria.maxPrice,transactionType:criteria.transactionType,type:criteria.propertyType,
        category:criteria.transactionType==='SALE'?'sale':criteria.transactionType==='RENT'?'rent':undefined,status:criteria.status,distressDeal:criteria.distressOnly},
      directCount:result.directCount,indirectCount:result.indirectCount,usedFallback:result.usedFallback})
    if (!result.properties.length) return { found:false,message:buildNoPropertiesMessage('en',criteria.area,result.reason),source:'none',matchQuality:'none',directCount:0,indirectCount:0,usedFallback:false,noResultReason:result.reason,trace:result.trace,criteria }
    const properties: Record<string,unknown>[] = []
    for (const property of result.properties) {
      const media = params.mediaRequested ? await new PropertyMediaService().list(params.orgId,property.id) : undefined
      properties.push({ ...property,...(media ? { media } : {}) })
    }
    return { ...result,found:true,message:'',properties,count:properties.length,criteria }
  } catch {
    return { found:false,message:'Listings could not be checked right now. Please try again.',source:'none',matchQuality:'none',noResultReason:'db_error',criteria }
  }
}
export function buildNoPropertiesMessage(lang:'en'|'ar',_area?:string,reason?:string): string {
  if (reason==='db_error') return lang==='ar'?'تعذر التحقق من القوائم الآن. يرجى المحاولة مرة أخرى.':'Listings could not be checked right now. Please try again.'
  if (reason==='ambiguous_reference') return lang==='ar'?'هذا المرجع مرتبط بأكثر من قائمة. يرجى تأكيد المرجع مع الفريق.':'This reference is ambiguous in our records. Please confirm it with the team.'
  if (reason==='reference_unavailable') return lang==='ar'?'العقار بهذا المرجع غير متاح حالياً.':'The listing with this reference is currently unavailable.'
  if (reason==='reference_not_found') return lang==='ar'?'لم أجد قائمة بهذا المرجع. يرجى التحقق من المرجع.':'I could not find a listing with this exact reference. Please check the reference.'
  return lang==='ar'?'لم أجد قوائم أخرى تطابق هذه الشروط. هل ترغب في تعديل معايير البحث؟':'I could not find further listings matching these criteria. Would you like to change the search criteria?'
}
