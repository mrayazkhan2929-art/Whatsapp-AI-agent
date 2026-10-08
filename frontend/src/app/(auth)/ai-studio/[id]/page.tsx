import { AIStudioDetail } from '@/components/pages/AIStudio'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AIStudioDetail id={id} />
}
