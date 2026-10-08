import {redirect} from 'next/navigation'

type AgentDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { id } = await params
  redirect('/ai-studio/'+encodeURIComponent(id))
}
