'use client'
import Link from 'next/link'
import {KnowledgeWorkspace} from '@/components/knowledge/KnowledgeWorkspace'
export function KnowledgeBaseDetailRoute({knowledgeBaseId}:{knowledgeBaseId:string}){return <div className="space-y-4"><Link href="/knowledge-base" className="text-sm text-teal-700">Back to knowledge bases</Link><KnowledgeWorkspace knowledgeBaseId={knowledgeBaseId}/></div>}
