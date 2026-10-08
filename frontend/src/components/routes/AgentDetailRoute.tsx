'use client'
import {AIStudioDetail} from '@/components/pages/AIStudio'
// Component compatibility for callers retained during the route migration.
export function AgentDetailRoute({agentId}:{agentId:string}){return <AIStudioDetail id={agentId}/>}
