import { getSupabaseAdmin } from '../config/supabase.js'
import { ConfigError, databaseError } from '../modules/config/AgentVersionService.js'
import { normalizeIdentity } from './PropertySearchCriteria.js'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function findPropertyByIdentity(db:SupabaseClient,orgId:string,identity:string) {
  const escaped=identity.trim().replace(/[\\%_]/g,'\\$&'),candidates:Record<string,any>[]=[]
  for(const key of ['ref','ref_number']) for(let offset=0;;offset+=1000){
    const result=await db.from('properties').select('*').eq('org_id',orgId).ilike(key,'%'+escaped+'%').order('id').range(offset,offset+999)
    if(result.error)databaseError(result.error)
    candidates.push(...result.data ?? []);if((result.data ?? []).length<1000)break
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity)){
    const result=await db.from('properties').select('*').eq('org_id',orgId).eq('id',identity);if(result.error)databaseError(result.error);candidates.push(...result.data ?? [])
  }
  const rows=[...new Map(candidates.filter(p=>p.org_id===orgId && [p.id,p.ref,p.ref_number].some(ref=>ref && normalizeIdentity(ref)===normalizeIdentity(identity))).map(p=>[p.id,p])).values()]
  if (!rows.length) throw new ConfigError(404,'PROPERTY_NOT_FOUND','Property was not found')
  if(rows.length>1) throw new ConfigError(409,'AMBIGUOUS_REFERENCE','Property reference is ambiguous')
  return rows[0]
}

export interface PropertyMedia { id?: string; media_type: 'image'|'video'|'brochure'|'floor_plan'|'location'; url: string; position: number }
export function safePropertyMediaUrl(value: string): boolean {
  try {
    const url = new URL(value), host=url.hostname.toLowerCase().replace(/\.$/,'')
    return url.protocol==='https:' && !url.username && !url.password && (!url.port || url.port==='443')
      && host.includes('.') && !host.endsWith('.local') && !host.endsWith('.localhost') && host!=='localhost'
      && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':') && !/\s/.test(value)
  } catch { return false }
}
export class PropertyMediaService {
  constructor(private readonly db = getSupabaseAdmin()) {}
  async list(orgId: string, propertyId: string): Promise<PropertyMedia[]> {
    const parent = await this.db.from('properties').select('id,image_urls').eq('org_id',orgId).eq('id',propertyId).maybeSingle()
    if (parent.error) databaseError(parent.error)
    if (!parent.data) throw new ConfigError(404,'PROPERTY_NOT_FOUND','Property was not found')
    const media = await this.db.from('property_media').select('id,media_type,url,position').eq('org_id',orgId).eq('property_id',propertyId).order('position').order('id')
    if (media.error) databaseError(media.error)
    const stored = (media.data ?? []).filter(row => safePropertyMediaUrl(row.url)) as PropertyMedia[]
    const existing = new Set(stored.map(row => row.url))
    // Newly imported legacy image_urls remain usable without another migration/backfill.
    const legacy = (parent.data.image_urls ?? []).filter((url: string) => safePropertyMediaUrl(url) && !existing.has(url)).map((url: string,position: number) => ({ media_type:'image' as const,url,position }))
    return [...stored,...legacy]
  }
}

// Every factual line is conditional on a stored value; missing bedrooms/location/transaction are never guessed.
export function formatVerifiedProperties(properties: Record<string,unknown>[], language: 'en'|'ar'): string {
  const ar=language==='ar', label=(en:string,arabic:string)=>ar?arabic:en
  return properties.map(p => {
    const rows = [label('Verified listing','قائمة موثقة')]
    for (const [key,en,arabic] of [['type','Type','النوع'],['district','Area','المنطقة'],['project','Project','المشروع'],['building','Building','المبنى'],['developer','Developer','المطور'],['bedrooms','Bedrooms','غرف النوم'],['bathrooms','Bathrooms','الحمامات'],['status','Status','الحالة']] as const) {
      if (p[key] !== null && p[key] !== undefined && String(p[key]).trim()) rows.push(`${label(en,arabic)}: ${p[key]}`)
    }
    if (p.size_sqft !== null && p.size_sqft !== undefined) rows.push(`${label('Size','المساحة')}: ${Number(p.size_sqft).toLocaleString('en-AE')} ${label('sqft','قدم مربع')}`)
    if (p.price_aed !== null && p.price_aed !== undefined) rows.push(`AED ${Number(p.price_aed).toLocaleString('en-AE')}`)
    if (p.transaction_type) rows.push(p.transaction_type==='RENT'?label('For rent','للإيجار'):label('For sale','للبيع'))
    rows.push(`${label('Ref','المرجع')}: ${p.ref_number || p.ref}`)
    if (p.agent_name) rows.push(`${label('Agent','الوكيل')}: ${p.agent_name}`)
    if (p.source==='indirect') rows.push(`${label('Partner listing','قائمة شريك')}${p.partner_agency?': '+p.partner_agency:''}`)
    if (Array.isArray(p.media)) for (const row of p.media as PropertyMedia[]) if (safePropertyMediaUrl(row.url)) rows.push(`${row.media_type}: ${row.url}`)
    return rows.join('\n')
  }).join('\n\n━━━━━━━━━━━━━━━━━━\n\n')
}
