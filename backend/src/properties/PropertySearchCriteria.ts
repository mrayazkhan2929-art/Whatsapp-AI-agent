import { z } from 'zod'

export const propertySearchCriteriaSchema = z.object({
  referenceNumber: z.string().trim().min(1).max(120).optional(),
  transactionType: z.enum(['SALE', 'RENT']).optional(),
  propertyType: z.enum(['apartment', 'villa', 'townhouse', 'penthouse']).optional(),
  project: z.string().trim().min(1).max(200).optional(),
  building: z.string().trim().min(1).max(200).optional(),
  area: z.string().trim().min(1).max(200).optional(),
  bedrooms: z.string().trim().min(1).max(20).optional(),
  minPrice: z.number().finite().nonnegative().optional(),
  maxPrice: z.number().finite().nonnegative().optional(),
  status: z.enum(['ready', 'off-plan']).optional(),
  developer: z.string().trim().min(1).max(200).optional(),
  distressOnly: z.boolean().optional(),
  excludeRefs: z.array(z.string().trim().min(1).max(120)).max(2000).default([]),
}).strict().refine(c => c.minPrice === undefined || c.maxPrice === undefined || c.minPrice <= c.maxPrice, 'Minimum budget must not exceed maximum budget')

export type PropertySearchCriteria = z.infer<typeof propertySearchCriteriaSchema>
export const normalizeIdentity = (value: string) => value.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ')
export const AREA_ALIASES: Record<string, string> = {
  'dubai marina': 'Dubai Marina', marina: 'Dubai Marina', 'دبي مارينا': 'Dubai Marina', 'مارينا': 'Dubai Marina',
  'jumeirah village circle': 'JVC', jvc: 'JVC', 'قرية جميرا الدائرية': 'JVC',
  'jumeirah lake towers': 'JLT', jlt: 'JLT', 'أبراج بحيرات جميرا': 'JLT',
  'downtown dubai': 'Downtown Dubai', downtown: 'Downtown Dubai', 'وسط مدينة دبي': 'Downtown Dubai',
  'business bay': 'Business Bay', 'الخليج التجاري': 'Business Bay', 'palm jumeirah': 'Palm Jumeirah', 'نخلة جميرا': 'Palm Jumeirah',
  'dubai hills': 'Dubai Hills', 'دبي هيلز': 'Dubai Hills', arjan: 'Arjan', 'أرجان': 'Arjan', jbr: 'JBR', jvt: 'JVT',
  'motor city': 'Motor City', 'dubai sports city': 'Dubai Sports City', dsc: 'Dubai Sports City',
  'silicon oasis': 'Dubai Silicon Oasis', dso: 'Dubai Silicon Oasis', 'al furjan': 'Al Furjan',
  'al zorah': 'Al Zorah', 'burj khalifa': 'Burj Khalifa', 'burja khalifa': 'Burj Khalifa',
  'arabian ranches': 'Arabian Ranches', 'damac hills': 'Damac Hills', 'town square': 'Town Square',
  'discovery gardens': 'Discovery Gardens', 'dubai islands': 'Dubai Islands', meydan: 'Meydan', majan: 'Majan',
  'dubai land residence complex': 'Dubai Land Residence Complex', dlrc: 'Dubai Land Residence Complex',
}
export const normalizeArea = (value: string) => {
  const direct = AREA_ALIASES[normalizeIdentity(value)]
  if (direct) return direct
  // Portal exports may append the familiar district abbreviation in brackets.
  // Only use a recognized alias; unknown parenthetical text remains exact.
  const suffix = value.trim().match(/^(.*?)\s*\(([^()]+)\)$/)
  return (suffix && AREA_ALIASES[normalizeIdentity(suffix[2])]) ?? value.trim()
}

// Legacy stores remain available for rollback. Translate their keys at one boundary.
export function criteriaFromLegacy(memory: Record<string, unknown>): PropertySearchCriteria {
  const raw = { ...memory, maxPrice: memory.maxPrice ?? memory.maxBudget, minPrice: memory.minPrice ?? memory.minBudget,
    propertyType: memory.propertyType ?? (['apartment', 'villa', 'townhouse', 'penthouse'].includes(String(memory.category)) ? memory.category : undefined),
    referenceNumber: memory.referenceNumber, distressOnly: memory.distressOnly ?? memory.distressPreferred,
    excludeRefs: Array.isArray(memory.excludeRefs) ? memory.excludeRefs : typeof memory.lastShownPropertyRefs === 'string' ? memory.lastShownPropertyRefs.split(',').filter(Boolean) : [],
  }
  const allowed = Object.fromEntries(Object.entries(raw).filter(([key, value]) => key in propertySearchCriteriaSchema.innerType().shape && value !== undefined && value !== null && value !== '').map(([key,value]) => [key,key==='bedrooms'?String(value):['minPrice','maxPrice'].includes(key)?Number(value):value]))
  if (typeof allowed.area==='string') allowed.area=normalizeArea(allowed.area)
  const parsed = propertySearchCriteriaSchema.safeParse(allowed)
  return parsed.success ? parsed.data : { excludeRefs: [] }
}
