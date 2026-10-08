import { ExecutionDetail } from '@/components/observability/ExecutionWorkspace'
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <ExecutionDetail id={id}/>}
