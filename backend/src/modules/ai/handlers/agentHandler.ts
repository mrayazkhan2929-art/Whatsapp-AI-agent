import { findBestResolvedAgent,findResolvedAgentByName,getResolvedClientFacingTeam,resolvedAgentCard,type ResolvedAgent } from '../agentResolver.js'
export interface AgentResponse {content:string;agent:Pick<ResolvedAgent,'id'|'name'|'phone'>|null}
export type AgentDirectoryKind='ceo'|'sales_manager'|'sales_team'|'all_agents'|'marketing'|'hr'|'support'
export function detectAgentDirectoryRequest(message:string):AgentDirectoryKind|null{
 if(/\bceo|chief executive\b/i.test(message))return 'ceo'
 if(/\bsales? manager\b/i.test(message))return 'sales_manager'
 if(/\ball.*(?:agents?|team)|(?:agents?|team).*list/i.test(message))return 'all_agents'
 return null
}
const unavailable=(lang:'en'|'ar'):AgentResponse=>({content:lang==='ar'?'تم تسجيل طلبك. لا يوجد مستشار متاح حالياً.':'Your request has been recorded. No team member is available right now.',agent:null})
export async function getDirectoryResponse(orgId:string,kind:AgentDirectoryKind,lang:'en'|'ar'):Promise<AgentResponse>{
 const team=(await getResolvedClientFacingTeam(orgId)).filter(m=>kind==='ceo'?m.role==='CEO':kind==='sales_manager'?m.role==='Sales Manager':true)
 return team.length?{content:team.map(m=>resolvedAgentCard(m,lang)).join('\n\n'),agent:team[0]}:unavailable(lang)
}
export async function getAgentResponse(orgId:string,lang:'en'|'ar',area?:string,budget?:number):Promise<AgentResponse>{const agent=await findBestResolvedAgent(orgId,area,budget);return agent?{content:resolvedAgentCard(agent,lang),agent}:unavailable(lang)}
export async function getAgentByName(orgId:string,nameHint:string,lang:'en'|'ar'):Promise<AgentResponse|null>{const agent=await findResolvedAgentByName(orgId,nameHint);return agent?{content:resolvedAgentCard(agent,lang),agent}:null}
export const buildCompanyWithAgentResponse=getAgentResponse
